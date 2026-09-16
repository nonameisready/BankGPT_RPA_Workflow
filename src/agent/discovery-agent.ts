import { randomUUID } from "node:crypto";
import type { SurfaceAction } from "../actions/action-schema.js";
import { resolveActionInputs } from "../capability/parameters.js";
import type { JsonlEvidenceStore } from "../evidence/jsonl-evidence-store.js";
import { AgentDecisionSchema, type LLMProvider } from "../interfaces/llm-provider.js";
import type { PolicyEngine } from "../interfaces/policy-engine.js";
import type { RunResult } from "../interfaces/run-result.js";
import type { RunTrace, RunTraceStep } from "../interfaces/run-trace.js";
import type { DiscoveryAgent as DiscoveryAgentInterface, DiscoveryRequest } from "../interfaces/runtime.js";
import type { SurfaceAdapter } from "../interfaces/surface-adapter.js";

export class DiscoveryAgent implements DiscoveryAgentInterface {
  constructor(
    private readonly surface: SurfaceAdapter,
    private readonly llm: LLMProvider,
    private readonly policy: PolicyEngine,
    private readonly evidence: JsonlEvidenceStore,
  ) {}

  async discover(request: DiscoveryRequest): Promise<{ trace: RunTrace; result: RunResult }> {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const steps: RunTraceStep[] = [];
    const outputs: Record<string, unknown> = {};
    const inputs = request.inputs ?? {};
    let result: RunResult = { runId, status: "HARD_FAILURE", code: "MAX_STEPS", outputs, evidence: [] };
    await this.evidence.initialize(runId, "discovery");
    try {
      await this.surface.start({ entryUrl: request.targetUrl, timeoutMs: request.timeoutMs });
      const deadline = Date.now() + request.timeoutMs;
      for (let index = 0; index < request.maxSteps; index++) {
        if (Date.now() >= deadline) { result = { ...result, code: "TIMEOUT", debugMessage: "Discovery timeout reached" }; break; }
        const stepId = `discover_${index + 1}`;
        const observation = await this.surface.observe();
        const screenshot = await this.evidence.saveScreenshot(await this.surface.screenshot(`observe-${index + 1}`), `observe-${index + 1}`);
        observation.screenshotPath = screenshot;
        await this.evidence.append({ timestamp: new Date().toISOString(), runId, mode: "discovery", event: "observation", stepId, payload: { url: observation.url, title: observation.title, screenshotPath: screenshot, visibleTextChars: observation.visibleText.length, controlCount: observation.controls.length, dialogCount: observation.dialogs.length, frameCount: observation.frames.length } });
        const decisionStarted = Date.now();
        const decision = AgentDecisionSchema.parse(await this.llm.decide({
          goal: request.goal,
          inputs,
          history: steps.map((step) => ({ action: step.action, result: { success: step.result.success, message: step.result.message, extractedValue: step.result.extractedValue } })),
          observation,
          policySummary: "Only allowlisted local routes and read-only actions. Financial submissions are blocked.",
          requiredOutputs: request.requiredOutputs,
        }));
        const action = decision.action;
        await this.evidence.append({ timestamp: new Date().toISOString(), runId, mode: "discovery", event: "llm_decision", stepId, payload: { provider: this.llm.evidenceMetadata.provider, ...(this.llm.evidenceMetadata.model ? { model: this.llm.evidenceMetadata.model } : {}), action: action.action, targetId: "target" in action ? action.target?.id : undefined, schema_valid: true, latency_ms: Date.now() - decisionStarted } });
        const executable = resolveActionInputs(action, inputs);
        const authorization = await this.policy.authorize(executable, { mode: "discovery", currentUrl: observation.url, stepId });
        if (!authorization.authorized) {
          result = { runId, status: authorization.disposition === "REQUIRE_HUMAN" ? "HUMAN_REQUIRED" : "HARD_FAILURE", code: "POLICY_VIOLATION", currentStepId: stepId, outputs, evidence: this.evidence.references(), debugMessage: authorization.reason };
          await this.evidence.append({ timestamp: new Date().toISOString(), runId, mode: "discovery", event: "policy_denied", stepId, payload: { action: action.action, reason: authorization.reason } });
          break;
        }
        if (action.action === "finish") {
          const missing = (request.requiredOutputs ?? []).filter((name) => !Object.hasOwn(outputs, name));
          if (action.status === "success" && missing.length) {
            result = { runId, status: "HARD_FAILURE", code: "MISSING_OUTPUTS", currentStepId: stepId, outputs, evidence: this.evidence.references(), debugMessage: `Missing: ${missing.join(", ")}` };
          } else {
            result = { runId, status: action.status === "success" ? "SUCCESS" : action.status === "business_outcome" ? "BUSINESS_OUTCOME" : "HARD_FAILURE", code: action.code ?? action.status.toUpperCase(), currentStepId: stepId, outputs, evidence: this.evidence.references() };
          }
          await this.evidence.append({ timestamp: new Date().toISOString(), runId, mode: "discovery", event: "finish", stepId, payload: { status: result.status, code: result.code } });
          break;
        }
        const actionResult = await this.surface.execute(executable);
        steps.push({ id: stepId, observation, action, result: actionResult, evidence: [screenshot] });
        if (action.action === "extract" && actionResult.success) outputs[action.output] = actionResult.extractedValue;
        await this.evidence.append({ timestamp: new Date().toISOString(), runId, mode: "discovery", event: "action", stepId, payload: { action: action.action, targetId: "target" in action ? action.target?.id : undefined, policy_authorized: true, policy: authorization.reason, success: actionResult.success, resolution: actionResult.resolution, duration_ms: actionResult.durationMs, output: action.action === "extract" ? action.output : undefined, message: actionResult.message } });
        if (!actionResult.success) {
          await this.evidence.saveScreenshot(await this.surface.screenshot(`failure-${stepId}`), `failure-${stepId}`);
          result = { runId, status: action.action === "request_human" ? "HUMAN_REQUIRED" : "HARD_FAILURE", code: action.action === "request_human" ? "HUMAN_REQUESTED" : "ACTION_FAILED", currentStepId: stepId, outputs, evidence: this.evidence.references(), debugMessage: actionResult.message };
          break;
        }
      }
    } catch (error) {
      result = { runId, status: "HARD_FAILURE", code: "DISCOVERY_EXCEPTION", outputs, evidence: this.evidence.references(), debugMessage: error instanceof Error ? error.message.slice(0, 500) : "Unknown discovery exception" };
      await this.evidence.append({ timestamp: new Date().toISOString(), runId, mode: "discovery", event: "exception", payload: { code: result.code, message: result.debugMessage } });
    } finally { await this.surface.close(); }
    const trace: RunTrace = { traceId: runId, goal: request.goal, inputs, steps, result, startedAt, finishedAt: new Date().toISOString() };
    await this.evidence.saveTrace(trace);
    result = { ...result, evidence: this.evidence.references() };
    return { trace, result };
  }
}
