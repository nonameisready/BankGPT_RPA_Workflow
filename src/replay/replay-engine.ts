import { randomUUID } from "node:crypto";
import type { SurfaceAction } from "../actions/action-schema.js";
import { resolveActionInputs } from "../capability/parameters.js";
import type { Checkpoint, CapabilityArtifact } from "../capability/artifact-schema.js";
import type { EvidenceStore } from "../interfaces/evidence-store.js";
import type { RunResult } from "../interfaces/run-result.js";
import type { ReplayEngine as ReplayEngineInterface, ReplayRequest } from "../interfaces/runtime.js";
import type { Observation, SurfaceAdapter } from "../interfaces/surface-adapter.js";

function validateInputs(artifact: CapabilityArtifact, inputs: Readonly<Record<string, unknown>>): void {
  for (const [name, definition] of Object.entries(artifact.inputs)) {
    const value = inputs[name];
    if (value === undefined) {
      if (definition.required && definition.default === undefined) throw new Error(`Missing input: ${name}`);
      continue;
    }
    const validType = definition.type === "integer" ? typeof value === "number" && Number.isInteger(value) : typeof value === definition.type;
    if (!validType) throw new Error(`Invalid input type: ${name}`);
    if (definition.pattern && typeof value === "string" && !new RegExp(definition.pattern).test(value)) throw new Error(`Input pattern mismatch: ${name}`);
    if (definition.enum && !definition.enum.includes(value as string | number | boolean | null)) throw new Error(`Input enum mismatch: ${name}`);
  }
}

async function checkpointPassed(checkpoint: Checkpoint, surface: SurfaceAdapter, outputs: Readonly<Record<string, unknown>>): Promise<boolean> {
  if (checkpoint.kind === "output") return Object.hasOwn(outputs, checkpoint.output) && outputs[checkpoint.output] !== undefined;
  return surface.check(checkpoint);
}

async function knownOutcome(artifact: CapabilityArtifact, surface: SurfaceAdapter): Promise<{ code: string; description: string } | null> {
  for (const outcome of artifact.business_outcomes) {
    if (await surface.check(outcome.checkpoint)) return { code: outcome.code, description: outcome.description };
  }
  return null;
}

function hardCode(observation: Observation): string | null {
  if (observation.visibleText.includes("PERMISSION_DENIED")) return "PERMISSION_DENIED";
  if (observation.visibleText.includes("APP_ERROR")) return "APP_ERROR";
  return null;
}

export class ReplayEngine implements ReplayEngineInterface {
  async run(request: ReplayRequest): Promise<RunResult> {
    const { artifact, inputs, surface, policy, evidence } = request;
    const runId = randomUUID();
    const outputs: Record<string, unknown> = {};
    let result: RunResult = { runId, status: "HARD_FAILURE", code: "REPLAY_INCOMPLETE", outputs, evidence: [] };
    await evidence.initialize(runId, "replay");
    try {
      validateInputs(artifact, inputs);
      await surface.start({ entryUrl: artifact.application.entry_url, timeoutMs: 15_000 });
      for (const step of artifact.steps) {
        const before = await surface.observe();
        if (before.dialogs.length) {
          await evidence.saveScreenshot(await surface.screenshot(`dialog-${step.id}`), `dialog-${step.id}`);
          result = { runId, status: "HUMAN_REQUIRED", code: "UNEXPECTED_DIALOG", currentStepId: step.id, outputs, evidence: evidence.references(), observedState: before.dialogs.map((dialog) => dialog.text).join(" ").slice(0, 500) };
          await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "human_required", stepId: step.id, payload: { code: result.code } });
          break;
        }
        const hardBefore = hardCode(before);
        if (hardBefore) { result = { runId, status: "HARD_FAILURE", code: hardBefore, currentStepId: step.id, outputs, evidence: evidence.references(), observedState: before.visibleText.slice(0, 500) }; break; }
        const businessBefore = await knownOutcome(artifact, surface);
        if (businessBefore) { result = { runId, status: "BUSINESS_OUTCOME", code: businessBefore.code, currentStepId: step.id, outputs, evidence: evidence.references(), observedState: businessBefore.description }; break; }
        for (const checkpoint of step.preconditions) {
          if (!await checkpointPassed(checkpoint, surface, outputs)) throw new Error(`Precondition failed at ${step.id}: ${checkpoint.kind}`);
        }
        const action = resolveActionInputs(step.action, inputs);
        const authorization = await policy.authorize(action, { mode: "replay", currentUrl: before.url, capabilityId: artifact.id, stepId: step.id });
        if (!authorization.authorized) {
          result = { runId, status: authorization.disposition === "REQUIRE_HUMAN" ? "HUMAN_REQUIRED" : "HARD_FAILURE", code: "POLICY_VIOLATION", currentStepId: step.id, outputs, evidence: evidence.references(), debugMessage: authorization.reason };
          await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "policy_denied", stepId: step.id, payload: { action: action.action, reason: authorization.reason } });
          break;
        }
        if (step.wait.before_ms) await new Promise((resolve) => setTimeout(resolve, step.wait.before_ms));
        let actionResult = await surface.execute(action);
        for (let attempt = 2; !actionResult.success && attempt <= step.recovery.max_attempts; attempt++) {
          if (step.recovery.backoff_ms) await new Promise((resolve) => setTimeout(resolve, step.recovery.backoff_ms));
          actionResult = await surface.execute(action);
        }
        if (step.wait.after_ms) await new Promise((resolve) => setTimeout(resolve, step.wait.after_ms));
        await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "step", stepId: step.id, payload: { action: action.action, targetId: "target" in action ? action.target?.id : undefined, policy: authorization.reason, success: actionResult.success, resolution: actionResult.resolution, duration_ms: actionResult.durationMs, message: actionResult.message } });
        if (!actionResult.success) {
          await evidence.saveScreenshot(await surface.screenshot(`failure-${step.id}`), `failure-${step.id}`);
          result = { runId, status: step.recovery.on_failure === "request_human" ? "HUMAN_REQUIRED" : "HARD_FAILURE", code: "ACTION_FAILED", currentStepId: step.id, outputs, evidence: evidence.references(), expectedState: step.description, debugMessage: actionResult.message };
          break;
        }
        if (action.action === "extract") outputs[action.output] = actionResult.extractedValue;
        const after = await surface.observe();
        if (after.dialogs.length) {
          await evidence.saveScreenshot(await surface.screenshot(`dialog-${step.id}`), `dialog-${step.id}`);
          result = { runId, status: "HUMAN_REQUIRED", code: "UNEXPECTED_DIALOG", currentStepId: step.id, outputs, evidence: evidence.references(), observedState: after.dialogs.map((dialog) => dialog.text).join(" ").slice(0, 500) };
          await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "human_required", stepId: step.id, payload: { code: result.code } });
          break;
        }
        const hardAfter = hardCode(after);
        if (hardAfter) { await evidence.saveScreenshot(await surface.screenshot(`hard-${step.id}`), `hard-${step.id}`); result = { runId, status: "HARD_FAILURE", code: hardAfter, currentStepId: step.id, outputs, evidence: evidence.references(), observedState: after.visibleText.slice(0, 500) }; break; }
        const business = await knownOutcome(artifact, surface);
        if (business) {
          await evidence.saveScreenshot(await surface.screenshot(`business-${step.id}`), `business-${step.id}`);
          await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "business_outcome", stepId: step.id, payload: { code: business.code } });
          result = { runId, status: "BUSINESS_OUTCOME", code: business.code, currentStepId: step.id, outputs, evidence: evidence.references(), observedState: business.description };
          break;
        }
        for (const checkpoint of step.postconditions) {
          if (!await checkpointPassed(checkpoint, surface, outputs)) throw new Error(`Postcondition failed at ${step.id}: ${checkpoint.kind}`);
        }
      }
      if (result.code === "REPLAY_INCOMPLETE") {
        for (const checkpoint of artifact.success) {
          if (!await checkpointPassed(checkpoint, surface, outputs)) throw new Error(`Final success checkpoint failed: ${checkpoint.kind}`);
        }
        await evidence.saveScreenshot(await surface.screenshot("replay-success"), "replay-success");
        result = { runId, status: "SUCCESS", code: "SUCCESS", outputs, evidence: evidence.references() };
        await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "success", payload: { outputs } });
      }
    } catch (error) {
      try { await evidence.saveScreenshot(await surface.screenshot("replay-exception"), "replay-exception"); } catch { /* Surface may not have started. */ }
      result = { runId, status: "HARD_FAILURE", code: "REPLAY_EXCEPTION", currentStepId: result.currentStepId, outputs, evidence: evidence.references(), debugMessage: error instanceof Error ? error.message.slice(0, 500) : "Unknown replay exception" };
      await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "exception", payload: { code: result.code, message: result.debugMessage } });
    } finally { await surface.close(); }
    return { ...result, evidence: evidence.references() };
  }
}
