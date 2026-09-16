import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright";
import type { SurfaceAction } from "../src/actions/action-schema.js";
import type { Checkpoint } from "../src/capability/artifact-schema.js";
import { resolveActionInputs } from "../src/capability/parameters.js";
import { parseArtifact } from "../src/capability/serialization.js";
import type { EvidenceEvent, EvidenceStore } from "../src/interfaces/evidence-store.js";
import type { ActionResult, Observation, SurfaceAdapter, SurfaceStartOptions } from "../src/interfaces/surface-adapter.js";
import { ConfigurablePolicyEngine, policyFromArtifact } from "../src/policy/configurable-policy-engine.js";
import { redact } from "../src/policy/redaction.js";
import { ReplayEngine } from "../src/replay/replay-engine.js";
import { LiveSessionControlManager } from "../src/handoff/live-session-control-manager.js";
import { resolveLocator } from "../src/surface/locator-resolver.js";

const example = parseArtifact(readFileSync(new URL("../capabilities/get-savings-balance.example.yaml", import.meta.url), "utf8"), "yaml");

class MemoryEvidenceStore implements EvidenceStore {
  events: EvidenceEvent[] = [];
  private refs: string[] = [];
  async initialize(runId: string): Promise<void> { this.refs.push(`/evidence/run-${runId}/events.jsonl`); }
  async append(event: EvidenceEvent): Promise<void> { this.events.push(event); }
  async saveScreenshot(_sourcePath: string, label: string): Promise<string> { const path = `/evidence/${label}.png`; this.refs.push(path); return path; }
  references(): ReadonlyArray<string> { return this.refs; }
}

class MockSurface implements SurfaceAdapter {
  actions: SurfaceAction[] = [];
  private memberId = "";
  private state: "search" | "member" | "not_found" | "dialog" | "permission" | "error" = "search";
  failSearchOnce = false;
  interstitialVisible = false;
  async start(_options: SurfaceStartOptions): Promise<void> { this.state = "search"; }
  async observe(): Promise<Observation> {
    return { url: this.state === "search" ? "http://localhost:4000/" : `http://localhost:4000/members/search?member_id=${this.memberId}`, title: this.state, visibleText: this.state === "not_found" ? "No member was found" : this.state === "permission" ? "PERMISSION_DENIED" : this.state === "error" ? "APP_ERROR" : this.state === "member" ? "Savings $12,340.22 USD" : "Member Search", controls: [], dialogs: this.state === "dialog" ? [{ text: "Records Notice" }] : [], frames: [] };
  }
  async execute(action: SurfaceAction): Promise<ActionResult> {
    this.actions.push(action);
    if (action.action === "navigate") this.state = "search";
    if (action.action === "fill") this.memberId = String(action.value);
    if (action.action === "click" && action.target.id === "dismiss_interstitial") { this.interstitialVisible = false; return { success: true, durationMs: 1 }; }
    if (action.action === "click" && this.failSearchOnce) { this.failSearchOnce = false; this.interstitialVisible = true; return { success: false, durationMs: 1, message: "Known help overlay blocked Search" }; }
    if (action.action === "click") this.state = this.memberId === "40400" ? "not_found" : this.memberId === "40300" ? "permission" : this.memberId === "50000" ? "error" : this.memberId === "88888" ? "dialog" : "member";
    if (action.action === "extract") return { success: true, durationMs: 1, extractedValue: action.output === "balance" ? 12340.22 : "USD" };
    return { success: true, durationMs: 1 };
  }
  async check(checkpoint: Checkpoint): Promise<boolean> {
    if (checkpoint.kind === "text") return new RegExp(checkpoint.expected, "i").test((await this.observe()).visibleText);
    if (checkpoint.kind === "business_outcome") return this.state === "not_found" && checkpoint.expected_text === "Member Not Found";
    if (checkpoint.kind === "element_visible") return checkpoint.target.id === "dismiss_interstitial" ? this.interstitialVisible : true;
    return false;
  }
  async screenshot(): Promise<string> { return "/mock/screenshot.png"; }
  getSessionId(): string { return "mock-session"; }
  async close(): Promise<void> {}
  dismissDialog(): void { if (this.state === "dialog") this.state = "member"; }
  navigateAway(): void { this.state = "search"; }
}

describe("deterministic runtime", () => {
  it("interpolates input references and rejects missing values", () => {
    const action = example.steps.find((step) => step.action.action === "fill")?.action;
    expect(action).toBeDefined();
    expect(resolveActionInputs(action!, { member_id: "40400" })).toMatchObject({ value: "40400" });
    expect(() => resolveActionInputs(action!, {})).toThrow(/Missing invocation input/);
  });

  it("enforces domains and action types in code", async () => {
    const policy = new ConfigurablePolicyEngine(policyFromArtifact(example));
    expect((await policy.authorize({ action: "navigate", url: "https://example.com/" }, { mode: "replay", currentUrl: "http://localhost:4000/" })).authorized).toBe(false);
    expect((await policy.authorize({ action: "upload", target: { id: "file", description: "File", strategies: [{ kind: "label", value: "File" }] }, path: "/tmp/file" }, { mode: "replay", currentUrl: "http://localhost:4000/" })).authorized).toBe(false);
    expect((await policy.authorize({ action: "click", target: { id: "open_account", description: "Open New Sub-Account", strategies: [{ kind: "role", role: "link", name: "Open New Sub-Account" }] } }, { mode: "replay", currentUrl: "http://localhost:4000/members/search" })).authorized).toBe(false);
  });

  it("redacts secret keys and sensitive values recursively", () => {
    expect(redact({ password: "secret", nested: { member_id: "12345", Authorization: "Bearer abc" } }, new Set(["member_id"]), new Set(["12345"])))
      .toEqual({ password: "[REDACTED]", nested: { member_id: "[REDACTED]", Authorization: "[REDACTED]" } });
    expect(redact("Goal mentions member 12345", new Set(), new Set(["12345"]))).toBe("Goal mentions member [REDACTED]");
  });

  it("resolves locator strategies in declared order", async () => {
    const missed = { waitFor: async () => { throw new Error("missing"); }, count: async () => 0 } as unknown as Locator;
    const found = { waitFor: async () => {}, count: async () => 1 } as unknown as Locator;
    const mainFrame = {};
    const page = { frames: () => [mainFrame], mainFrame: () => mainFrame, getByRole: () => missed, getByLabel: () => found } as unknown as Page;
    const resolution = await resolveLocator(page, { id: "member_id_field", description: "Member ID", strategies: [{ kind: "role", role: "textbox", name: "Wrong" }, { kind: "label", value: "Member ID" }] }, 10);
    expect(resolution?.strategyIndex).toBe(1);
    expect(resolution?.strategyKind).toBe("label");
  });

  it("replays success without an LLM dependency", async () => {
    const surface = new MockSurface();
    const evidence = new MemoryEvidenceStore();
    const result = await new ReplayEngine().run({ artifact: example, inputs: { member_id: "12345" }, surface, policy: new ConfigurablePolicyEngine(policyFromArtifact(example)), evidence });
    expect(result.status).toBe("SUCCESS");
    expect(result.outputs).toEqual({ balance: 12340.22, currency: "USD" });
    expect(surface.actions.map((action) => action.action)).toEqual(["navigate", "fill", "click", "extract", "extract"]);
    expect(evidence.events.some((event) => event.event === "success")).toBe(true);
  });

  it("classifies a known no-member result before extraction", async () => {
    const surface = new MockSurface();
    const evidence = new MemoryEvidenceStore();
    const result = await new ReplayEngine().run({ artifact: example, inputs: { member_id: "40400" }, surface, policy: new ConfigurablePolicyEngine(policyFromArtifact(example)), evidence });
    expect(result).toMatchObject({ status: "BUSINESS_OUTCOME", code: "MEMBER_NOT_FOUND" });
    expect(surface.actions.map((action) => action.action)).toEqual(["navigate", "fill", "click"]);
    expect(evidence.events.some((event) => event.event === "terminal_condition")).toBe(true);
  });

  it("classifies declared permission and app failures without demo-specific runtime strings", async () => {
    for (const [memberId, code] of [["40300", "PERMISSION_DENIED"], ["50000", "APP_ERROR"]]) {
      const surface = new MockSurface();
      const result = await new ReplayEngine().run({ artifact: example, inputs: { member_id: memberId }, surface, policy: new ConfigurablePolicyEngine(policyFromArtifact(example)), evidence: new MemoryEvidenceStore() });
      expect(result).toMatchObject({ status: "HARD_FAILURE", code });
      expect(surface.actions.map((action) => action.action)).toEqual(["navigate", "fill", "click"]);
    }
  });

  it("uses artifact defaults unless the caller overrides them", async () => {
    const artifact = parseArtifact(JSON.stringify({ ...example, inputs: { ...example.inputs, member_id: { ...example.inputs.member_id, default: "12345" } } }), "json");
    const defaultSurface = new MockSurface();
    const defaultResult = await new ReplayEngine().run({ artifact, inputs: {}, surface: defaultSurface, policy: new ConfigurablePolicyEngine(policyFromArtifact(artifact)), evidence: new MemoryEvidenceStore() });
    expect(defaultResult.status).toBe("SUCCESS");
    expect(defaultSurface.actions.find((action) => action.action === "fill")).toMatchObject({ value: "12345" });
    const overrideResult = await new ReplayEngine().run({ artifact, inputs: { member_id: "40400" }, surface: new MockSurface(), policy: new ConfigurablePolicyEngine(policyFromArtifact(artifact)), evidence: new MemoryEvidenceStore() });
    expect(overrideResult).toMatchObject({ status: "BUSINESS_OUTCOME", code: "MEMBER_NOT_FOUND" });
  });

  it("dismisses only a declared visible interstitial and retries within max_attempts", async () => {
    const dismissTarget = { id: "dismiss_interstitial", description: "Dismiss known help overlay", strategies: [{ kind: "role", role: "button", name: "Close Help" }] };
    const artifact = parseArtifact(JSON.stringify({ ...example, steps: example.steps.map((step) => step.action.action === "click" ? { ...step, recovery: { max_attempts: 2, backoff_ms: 0, on_failure: "fail", known_interstitial: { dismiss_target: dismissTarget } } } : step) }), "json");
    const surface = new MockSurface();
    surface.failSearchOnce = true;
    const evidence = new MemoryEvidenceStore();
    const result = await new ReplayEngine().run({ artifact, inputs: { member_id: "12345" }, surface, policy: new ConfigurablePolicyEngine(policyFromArtifact(artifact)), evidence });
    expect(result.status).toBe("SUCCESS");
    expect(surface.actions.filter((action) => action.action === "click").map((action) => action.target.id)).toEqual(["search_button", "dismiss_interstitial", "search_button"]);
    expect(evidence.events.some((event) => event.event === "known_interstitial")).toBe(true);
  });

  it("records same-session ownership transitions through a real manager", async () => {
    const surface = new MockSurface();
    const evidence = new MemoryEvidenceStore();
    const manager = new LiveSessionControlManager(async () => {
      expect(manager.owner(surface.getSessionId())).toBe("human");
      surface.dismissDialog();
    });
    const result = await new ReplayEngine().run({ artifact: example, inputs: { member_id: "88888" }, surface, policy: new ConfigurablePolicyEngine(policyFromArtifact(example)), evidence, sessionControl: manager });
    expect(result.status).toBe("SUCCESS");
    expect(result.interventionIds).toHaveLength(1);
    expect(manager.owner(surface.getSessionId())).toBe("automation");
    expect(evidence.events.map((event) => event.event)).toContain("human_takeover");
    expect(evidence.events.map((event) => event.event)).toContain("automation_resumed");
  });

  it("does not continue automation if the human changes the application location", async () => {
    const surface = new MockSurface();
    const evidence = new MemoryEvidenceStore();
    const manager = new LiveSessionControlManager(async () => surface.navigateAway());
    const result = await new ReplayEngine().run({ artifact: example, inputs: { member_id: "88888" }, surface, policy: new ConfigurablePolicyEngine(policyFromArtifact(example)), evidence, sessionControl: manager });
    expect(result).toMatchObject({ status: "HUMAN_REQUIRED", code: "HUMAN_CHANGED_APPLICATION_STATE" });
    expect(surface.actions.map((action) => action.action)).toEqual(["navigate", "fill", "click"]);
    expect(evidence.events.some((event) => event.event === "human_state_drift")).toBe(true);
  });

  it("stops on an unexpected dialog without claiming success", async () => {
    const surface = new MockSurface();
    const evidence = new MemoryEvidenceStore();
    const result = await new ReplayEngine().run({ artifact: example, inputs: { member_id: "88888" }, surface, policy: new ConfigurablePolicyEngine(policyFromArtifact(example)), evidence });
    expect(result).toMatchObject({ status: "HUMAN_REQUIRED", code: "UNEXPECTED_DIALOG" });
    expect(surface.actions.map((action) => action.action)).toEqual(["navigate", "fill", "click"]);
  });
});
