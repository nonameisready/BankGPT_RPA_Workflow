import type { SurfaceAction, Target } from "../actions/action-schema.js";
import { CapabilityArtifactSchema, type CapabilityArtifact, type CapabilityStep } from "./artifact-schema.js";
import type { CapabilityCompiler as CompilerInterface, CompilationHints } from "../interfaces/capability-compiler.js";
import type { RunTrace } from "../interfaces/run-trace.js";
import type { Observation } from "../interfaces/surface-adapter.js";

function parameterize(action: SurfaceAction, observation: Observation, trace: RunTrace, hints: CompilationHints): SurfaceAction {
  const copy: Record<string, unknown> = { ...action };
  for (const field of ["url", "value", "path", "expected"]) {
    if (!(field in copy)) continue;
    const observed = copy[field];
    if (observed && typeof observed === "object" && "from_input" in observed) continue;
    for (const inputName of hints.inputNames) {
      if (trace.inputs[inputName] === observed) { copy[field] = { from_input: inputName }; break; }
    }
  }
  if (action.action === "extract") {
    if (hints.outputTargets?.[action.output]) copy.target = hints.outputTargets[action.output];
    if (hints.outputTransforms?.[action.output]) copy.transform = hints.outputTransforms[action.output];
  }
  if ("target" in action && copy.target && typeof copy.target === "object") {
    const target = copy.target as Target;
    const strategies = target.strategies.map((strategy) => {
      if (strategy.kind !== "role" || strategy.name) return strategy;
      const matches = observation.controls.filter((control) => (control.role ?? control.kind) === strategy.role && control.name?.trim());
      return matches.length === 1 ? { ...strategy, name: matches[0]!.name!.trim() } : strategy;
    });
    copy.target = { ...target, description: scrubInputValues(target.description, trace, hints), strategies };
  }
  if (typeof action.reason === "string") copy.reason = scrubInputValues(action.reason, trace, hints);
  return copy as SurfaceAction;
}

function scrubInputValues(text: string, trace: RunTrace, hints: CompilationHints): string {
  let clean = text;
  for (const inputName of hints.inputNames) {
    const value = trace.inputs[inputName];
    if (value !== undefined && value !== null && String(value)) clean = clean.replaceAll(String(value), `{from_input:${inputName}}`);
  }
  return clean;
}

function stepId(action: SurfaceAction, index: number): string {
  const targetId = "target" in action ? action.target?.id : undefined;
  return `${action.action}_${targetId ?? index + 1}`.replace(/[^a-z0-9_-]/g, "_");
}

export class CapabilityCompiler implements CompilerInterface {
  async compile(trace: RunTrace, hints: CompilationHints): Promise<CapabilityArtifact> {
    if (trace.result.status !== "SUCCESS") throw new Error("Only successful discovery traces can be compiled");
    if (hints.outputNames.some((name) => !Object.hasOwn(trace.result.outputs, name))) throw new Error("Discovery trace lacks declared outputs");
    const reusable = trace.steps.filter((step) => step.result.success && !["request_human", "finish"].includes(step.action.action));
    if (!reusable.length) throw new Error("No reusable successful steps in trace");
    const seenIds = new Map<string, number>();
    const steps: CapabilityStep[] = reusable.map((traceStep, index) => {
      const action = parameterize(traceStep.action, traceStep.observation, trace, hints);
      const baseId = stepId(action, index);
      const occurrence = (seenIds.get(baseId) ?? 0) + 1;
      seenIds.set(baseId, occurrence);
      return {
        id: occurrence === 1 ? baseId : `${baseId}_${occurrence}`,
        description: action.reason ?? `Execute ${action.action}${"target" in action ? ` on ${action.target?.description}` : ""}`,
        action,
        preconditions: [],
        postconditions: action.action === "extract" ? [{ kind: "output", output: action.output, timeout_ms: 10_000 }] : [],
        wait: { before_ms: 0, after_ms: 0 },
        recovery: { max_attempts: action.action === "click" ? 2 : 1, backoff_ms: action.action === "click" ? 300 : 0, on_failure: "fail" },
      };
    });
    const outputTypes = Object.fromEntries(hints.outputNames.map((name) => [name, {
      type: ["currency", "number"].includes(hints.outputTransforms?.[name] ?? "") || typeof trace.result.outputs[name] === "number" ? "number" : typeof trace.result.outputs[name] === "boolean" ? "boolean" : "string",
      description: `Output ${name} extracted by the capability`, nullable: false, sensitive: false,
    }]));
    const inputs = Object.fromEntries(hints.inputNames.map((name) => [name, {
      type: typeof trace.inputs[name] === "number" ? "number" : typeof trace.inputs[name] === "boolean" ? "boolean" : "string",
      description: `Invocation input ${name}`, required: true, sensitive: false,
    }]));
    const candidate = {
      schema_version: "1.0",
      id: hints.capabilityId,
      version: "1.0.0",
      name: hints.name,
      description: hints.description,
      approval: "draft",
      application: hints.application,
      inputs,
      outputs: outputTypes,
      risk: hints.risk,
      policy: hints.policy,
      steps,
      success: hints.outputNames.map((output) => ({ kind: "output", output })),
      business_outcomes: hints.businessOutcomes ?? [],
      terminal_conditions: hints.terminalConditions ?? [],
      tenant_overrides: [],
      metadata: { created_at: new Date().toISOString(), created_by: "capability-compiler", source_trace_id: trace.traceId, description_notes: [hints.goalCompletion], contains_secrets: false },
    };
    const serialized = JSON.stringify(candidate);
    for (const inputName of hints.inputNames) {
      const value = trace.inputs[inputName];
      if (value !== undefined && value !== null && String(value) && serialized.includes(String(value))) throw new Error(`Artifact still contains invocation value for ${inputName}`);
    }
    return CapabilityArtifactSchema.parse(candidate);
  }
}
