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
  private state: "search" | "member" | "not_found" | "dialog" = "search";
  async start(_options: SurfaceStartOptions): Promise<void> { this.state = "search"; }
  async observe(): Promise<Observation> {
    return { url: this.state === "search" ? "http://localhost:4000/" : `http://localhost:4000/members/search?member_id=${this.memberId}`, title: this.state, visibleText: this.state === "not_found" ? "Member Not Found" : this.state === "member" ? "Savings $12,340.22 USD" : "Member Search", controls: [], dialogs: this.state === "dialog" ? [{ text: "Records Notice" }] : [], frames: [] };
  }
  async execute(action: SurfaceAction): Promise<ActionResult> {
    this.actions.push(action);
    if (action.action === "navigate") this.state = "search";
    if (action.action === "fill") this.memberId = String(action.value);
    if (action.action === "click") this.state = this.memberId === "40400" ? "not_found" : this.memberId === "88888" ? "dialog" : "member";
    if (action.action === "extract") return { success: true, durationMs: 1, extractedValue: action.output === "balance" ? 12340.22 : "USD" };
    return { success: true, durationMs: 1 };
  }
  async check(checkpoint: Checkpoint): Promise<boolean> {
    if (checkpoint.kind === "business_outcome") return this.state === "not_found" && checkpoint.expected_text === "Member Not Found";
    if (checkpoint.kind === "element_visible") return true;
    return false;
  }
  async screenshot(): Promise<string> { return "/mock/screenshot.png"; }
  getSessionId(): string { return "mock-session"; }
  async close(): Promise<void> {}
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
    expect(evidence.events.some((event) => event.event === "business_outcome")).toBe(true);
  });

  it("stops on an unexpected dialog without claiming success", async () => {
    const surface = new MockSurface();
    const evidence = new MemoryEvidenceStore();
    const result = await new ReplayEngine().run({ artifact: example, inputs: { member_id: "88888" }, surface, policy: new ConfigurablePolicyEngine(policyFromArtifact(example)), evidence });
    expect(result).toMatchObject({ status: "HUMAN_REQUIRED", code: "UNEXPECTED_DIALOG" });
    expect(surface.actions.map((action) => action.action)).toEqual(["navigate", "fill", "click"]);
  });
});
