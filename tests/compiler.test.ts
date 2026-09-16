import { describe, expect, it } from "vitest";
import { CapabilityCompiler } from "../src/capability/capability-compiler.js";
import type { CompilationHints } from "../src/interfaces/capability-compiler.js";
import type { RunTrace } from "../src/interfaces/run-trace.js";

const observation = { url: "http://localhost:4000/", title: "Member Search", visibleText: "Member ID Search", controls: [], dialogs: [], frames: [] };
const target = { id: "member_id_field", description: "Member ID field", strategies: [{ kind: "label" as const, value: "Member ID" }] };
const trace: RunTrace = {
  traceId: "trace-test", goal: "Look up member 12345", inputs: { member_id: "12345" }, startedAt: "2026-09-15T00:00:00.000Z", finishedAt: "2026-09-15T00:01:00.000Z",
  steps: [{ id: "step_1", observation, action: { action: "fill", target, value: "12345", reason: "Enter member 12345" }, result: { success: true, durationMs: 1 }, evidence: [] }],
  result: { runId: "trace-test", status: "SUCCESS", code: "SUCCESS", outputs: { balance: 12340.22, currency: "USD" }, evidence: [] },
};
const hints: CompilationHints = {
  capabilityId: "legacybank.get_savings_balance", name: "Get Savings Balance", description: "Read a fake balance", inputNames: ["member_id"], outputNames: ["balance", "currency"], goalCompletion: "Outputs extracted",
  application: { vendor_family: "LegacyBank", app_family: "Simulator", compatible_versions: ["7.x"], entry_url: "http://localhost:4000", fingerprint_hints: {} },
  policy: { allowed_domains: ["localhost"], allowed_route_patterns: ["^/$"], allowed_actions: ["fill"], blocked_target_patterns: [], risky_action_behavior: "BLOCK" }, risk: "SAFE",
};

describe("CapabilityCompiler", () => {
  it("parameterizes observed inputs and removes them from reusable rationale", async () => {
    const artifact = await new CapabilityCompiler().compile(trace, hints);
    expect(artifact.steps[0]?.action).toMatchObject({ value: { from_input: "member_id" } });
    expect(JSON.stringify(artifact)).not.toContain("12345");
    expect(artifact.metadata.source_trace_id).toBe("trace-test");
  });

  it("rejects a failed trace", async () => {
    const failed: RunTrace = { ...trace, result: { ...trace.result, status: "HARD_FAILURE" } };
    await expect(new CapabilityCompiler().compile(failed, hints)).rejects.toThrow(/Only successful/);
  });
});
