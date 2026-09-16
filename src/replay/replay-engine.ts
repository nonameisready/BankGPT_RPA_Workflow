import { randomUUID } from "node:crypto";
import type { SurfaceAction } from "../actions/action-schema.js";
import { resolveActionInputs } from "../capability/parameters.js";
import type { Checkpoint, CapabilityArtifact } from "../capability/artifact-schema.js";
import type { EvidenceStore } from "../interfaces/evidence-store.js";
import type { RunResult } from "../interfaces/run-result.js";
import type { InterventionRequest } from "../interfaces/session-control.js";
import type { ReplayEngine as ReplayEngineInterface, ReplayRequest } from "../interfaces/runtime.js";
import type { Observation, SurfaceAdapter } from "../interfaces/surface-adapter.js";

function effectiveInputsFor(artifact: CapabilityArtifact, callerInputs: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const effective: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(artifact.inputs)) {
    if (definition.default !== undefined) effective[name] = definition.default;
  }
  for (const [name, value] of Object.entries(callerInputs)) {
    if (value !== undefined) effective[name] = value;
  }
  return effective;
}

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

async function declaredTerminalCondition(artifact: CapabilityArtifact, surface: SurfaceAdapter): Promise<{ code: string; status: "BUSINESS_OUTCOME" | "HARD_FAILURE"; description: string } | null> {
  for (const condition of artifact.terminal_conditions) {
    if (await surface.check(condition.checkpoint)) return { code: condition.code, status: condition.status, description: condition.description };
  }
  // Legacy business_outcomes remain readable for artifacts generated before terminal_conditions.
  for (const outcome of artifact.business_outcomes) {
    if (await surface.check(outcome.checkpoint)) return { code: outcome.code, status: "BUSINESS_OUTCOME", description: outcome.description };
  }
  return null;
}

export class ReplayEngine implements ReplayEngineInterface {
  async run(request: ReplayRequest): Promise<RunResult> {
    const { artifact, inputs, surface, policy, evidence, sessionControl } = request;
    const runId = randomUUID();
    const outputs: Record<string, unknown> = {};
    const interventionIds: string[] = [];
    let result: RunResult = { runId, status: "HARD_FAILURE", code: "REPLAY_INCOMPLETE", outputs, evidence: [] };
    await evidence.initialize(runId, "replay");
    const handleDialogs = async (stepId: string, initial: Observation): Promise<{ observation: Observation; stopped: boolean }> => {
      let observation = initial;
      while (observation.dialogs.length) {
        const screenshotPath = await evidence.saveScreenshot(await surface.screenshot(`intervention-${stepId}`), `intervention-${stepId}`);
        const intervention: InterventionRequest = {
          interventionId: randomUUID(), runId, goalOrCapability: artifact.id, stepId,
          reason: "Unexpected application dialog blocks deterministic replay",
          screenshotPath, currentUrl: observation.url,
          stateSummary: observation.dialogs.map((dialog) => dialog.text).join(" ").slice(0, 500),
          requestedAction: "Handle the dialog in this same live browser window and signal resume",
          createdAt: new Date().toISOString(),
        };
        interventionIds.push(intervention.interventionId);
        await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "intervention_request", stepId, payload: { ...intervention, sessionId: surface.getSessionId() } });
        if (!sessionControl) {
          result = { runId, status: "HUMAN_REQUIRED", code: "UNEXPECTED_DIALOG", currentStepId: stepId, outputs, evidence: evidence.references(), observedState: intervention.stateSummary };
          return { observation, stopped: true };
        }
        const sessionId = surface.getSessionId();
        await sessionControl.request(sessionId, intervention);
        await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "session_paused", stepId, payload: { sessionId, owner: sessionControl.owner(sessionId), interventionId: intervention.interventionId } });
        await sessionControl.takeControl(sessionId);
        await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "human_takeover", stepId, payload: { sessionId, owner: sessionControl.owner(sessionId), interventionId: intervention.interventionId } });
        await sessionControl.awaitHumanAction(sessionId);
        await sessionControl.resume(sessionId);
        await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "automation_resumed", stepId, payload: { sessionId, owner: sessionControl.owner(sessionId), interventionId: intervention.interventionId } });
        observation = await surface.observe();
        if (observation.url !== intervention.currentUrl) {
          await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "human_state_drift", stepId, payload: { expectedUrl: intervention.currentUrl, observedUrl: observation.url, interventionId: intervention.interventionId } });
          result = { runId, status: "HUMAN_REQUIRED", code: "HUMAN_CHANGED_APPLICATION_STATE", currentStepId: stepId, outputs, evidence: evidence.references(), expectedState: intervention.currentUrl, observedState: observation.url };
          return { observation, stopped: true };
        }
      }
      return { observation, stopped: false };
    };
    try {
      const effectiveInputs = effectiveInputsFor(artifact, inputs);
      validateInputs(artifact, effectiveInputs);
      await surface.start({ entryUrl: artifact.application.entry_url, headed: request.headed === true, timeoutMs: 15_000 });
      for (const step of artifact.steps) {
        const beforeHandoff = await handleDialogs(step.id, await surface.observe());
        if (beforeHandoff.stopped) break;
        const before = beforeHandoff.observation;
        const terminalBefore = await declaredTerminalCondition(artifact, surface);
        if (terminalBefore) {
          await evidence.saveScreenshot(await surface.screenshot(`terminal-${step.id}`), `terminal-${step.id}`);
          await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "terminal_condition", stepId: step.id, payload: { code: terminalBefore.code, status: terminalBefore.status } });
          result = { runId, status: terminalBefore.status, code: terminalBefore.code, currentStepId: step.id, outputs, evidence: evidence.references(), observedState: terminalBefore.description };
          break;
        }
        for (const checkpoint of step.preconditions) {
          if (!await checkpointPassed(checkpoint, surface, outputs)) throw new Error(`Precondition failed at ${step.id}: ${checkpoint.kind}`);
        }
        const action = resolveActionInputs(step.action, effectiveInputs);
        const authorization = await policy.authorize(action, { mode: "replay", currentUrl: before.url, capabilityId: artifact.id, stepId: step.id });
        if (!authorization.authorized) {
          result = { runId, status: authorization.disposition === "REQUIRE_HUMAN" ? "HUMAN_REQUIRED" : "HARD_FAILURE", code: "POLICY_VIOLATION", currentStepId: step.id, outputs, evidence: evidence.references(), debugMessage: authorization.reason };
          await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "policy_denied", stepId: step.id, payload: { action: action.action, reason: authorization.reason } });
          break;
        }
        if (step.wait.before_ms) await new Promise((resolve) => setTimeout(resolve, step.wait.before_ms));
        let actionResult = await surface.execute(action);
        for (let attempt = 2; !actionResult.success && attempt <= step.recovery.max_attempts; attempt++) {
          if (step.recovery.known_interstitial) {
            const dismissTarget = step.recovery.known_interstitial.dismiss_target;
            if (await surface.check({ kind: "element_visible", target: dismissTarget, timeout_ms: 300 })) {
              const dismissAction: SurfaceAction = { action: "click", target: dismissTarget, reason: "Dismiss declared known interstitial before retry" };
              const dismissPolicy = await policy.authorize(dismissAction, { mode: "replay", currentUrl: (await surface.observe()).url, capabilityId: artifact.id, stepId: step.id });
              if (!dismissPolicy.authorized) {
                await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "policy_denied", stepId: step.id, payload: { action: "click", targetId: dismissTarget.id, reason: dismissPolicy.reason } });
                break;
              }
              const dismissal = await surface.execute(dismissAction);
              await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "known_interstitial", stepId: step.id, payload: { targetId: dismissTarget.id, success: dismissal.success } });
              if (!dismissal.success) break;
            }
          }
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
        const afterHandoff = await handleDialogs(step.id, await surface.observe());
        if (afterHandoff.stopped) break;
        const after = afterHandoff.observation;
        const terminal = await declaredTerminalCondition(artifact, surface);
        if (terminal) {
          await evidence.saveScreenshot(await surface.screenshot(`terminal-${step.id}`), `terminal-${step.id}`);
          await evidence.append({ timestamp: new Date().toISOString(), runId, mode: "replay", event: "terminal_condition", stepId: step.id, payload: { code: terminal.code, status: terminal.status } });
          result = { runId, status: terminal.status, code: terminal.code, currentStepId: step.id, outputs, evidence: evidence.references(), observedState: terminal.description };
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
    return { ...result, evidence: evidence.references(), ...(interventionIds.length ? { interventionIds } : {}) };
  }
}
