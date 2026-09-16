import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createLegacyBankApp } from "../demo/legacy-bank/app.js";
import { CapabilityArtifactSchema, type CapabilityArtifact } from "../src/capability/artifact-schema.js";
import { parseArtifact } from "../src/capability/serialization.js";
import { JsonlEvidenceStore } from "../src/evidence/jsonl-evidence-store.js";
import { LiveSessionControlManager } from "../src/handoff/live-session-control-manager.js";
import { ConfigurablePolicyEngine, policyFromArtifact } from "../src/policy/configurable-policy-engine.js";
import { ReplayEngine } from "../src/replay/replay-engine.js";
import { PlaywrightSurfaceAdapter } from "../src/surface/playwright-surface-adapter.js";

const example = parseArtifact(await readFile(new URL("../capabilities/get-savings-balance.example.yaml", import.meta.url), "utf8"), "yaml");

describe("real LegacyBank browser replay", () => {
  let server: Server;
  let evidenceRoot: string;
  let artifact: CapabilityArtifact;

  beforeAll(async () => {
    server = createLegacyBankApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const entryUrl = `http://127.0.0.1:${address.port}`;
    artifact = CapabilityArtifactSchema.parse({
      ...example,
      application: { ...example.application, entry_url: entryUrl },
      policy: { ...example.policy, allowed_domains: ["127.0.0.1"] },
      steps: example.steps.map((step) => step.action.action === "navigate"
        ? { ...step, action: { ...step.action, url: entryUrl } }
        : step),
    });
    evidenceRoot = await mkdtemp(join(tmpdir(), "legacybank-playwright-integration-"));
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(evidenceRoot, { recursive: true, force: true });
  });

  async function replay(memberId: string, sessionControl?: LiveSessionControlManager, surface = new PlaywrightSurfaceAdapter("chrome")) {
    const evidence = new JsonlEvidenceStore(evidenceRoot);
    const result = await new ReplayEngine().run({
      artifact, inputs: { member_id: memberId }, surface,
      policy: new ConfigurablePolicyEngine(policyFromArtifact(artifact)), evidence,
      ...(sessionControl ? { sessionControl } : {}),
    });
    const events = (await readFile(join(evidence.directory(), "events.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line) as { event: string; payload: { action?: string; code?: string; status?: string } });
    return { result, events, evidence };
  }

  it("returns the savings balance and currency from the real iframe table", async () => {
    const { result, events } = await replay("12345");
    expect(result).toMatchObject({ status: "SUCCESS", outputs: { balance: 12340.22, currency: "USD" } });
    expect(events.filter((event) => event.payload.action === "extract")).toHaveLength(2);
    expect(result.evidence.some((path) => path.endsWith(".png"))).toBe(true);
  }, 30_000);

  it("classifies the actual 404 alert before any extraction step", async () => {
    const { result, events } = await replay("40400");
    expect(result).toMatchObject({ status: "BUSINESS_OUTCOME", code: "MEMBER_NOT_FOUND" });
    expect(events.filter((event) => event.payload.action === "extract")).toHaveLength(0);
    expect(events.find((event) => event.event === "terminal_condition")?.payload).toMatchObject({ code: "MEMBER_NOT_FOUND", status: "BUSINESS_OUTCOME" });
  }, 30_000);

  it("classifies actual 403 and 500 pages from declared terminal conditions", async () => {
    for (const [memberId, code] of [["40300", "PERMISSION_DENIED"], ["50000", "APP_ERROR"]]) {
      const { result, events } = await replay(memberId!);
      expect(result).toMatchObject({ status: "HARD_FAILURE", code });
      expect(events.filter((event) => event.payload.action === "extract")).toHaveLength(0);
      expect(events.find((event) => event.event === "terminal_condition")?.payload).toMatchObject({ code, status: "HARD_FAILURE" });
    }
  }, 60_000);

  it("pauses and resumes the same real Playwright browser session after operator action", async () => {
    const surface = new PlaywrightSurfaceAdapter("chrome");
    const sessionId = surface.getSessionId();
    const manager = new LiveSessionControlManager(async (intervention) => {
      expect(manager.owner(sessionId)).toBe("human");
      expect(intervention.runId).toBeTruthy();
      expect((await stat(intervention.screenshotPath)).size).toBeGreaterThan(0);
      const dismissal = await surface.execute({ action: "click", target: { id: "operator_acknowledge_notice", description: "Acknowledge Records Notice", strategies: [{ kind: "role", role: "button", name: "Acknowledge and Continue" }] } });
      expect(dismissal.success).toBe(true);
      expect(surface.getSessionId()).toBe(sessionId);
    });
    const { result, events } = await replay("88888", manager, surface);
    expect(result).toMatchObject({ status: "SUCCESS", outputs: { balance: 888.88, currency: "USD" } });
    expect(result.interventionIds).toHaveLength(1);
    expect(manager.owner(sessionId)).toBe("automation");
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining(["intervention_request", "session_paused", "human_takeover", "automation_resumed", "success"]));
  }, 30_000);
});
