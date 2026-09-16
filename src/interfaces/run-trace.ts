import type { SurfaceAction } from "../actions/action-schema.js";
import type { Observation, ActionResult } from "./surface-adapter.js";
import type { RunResult } from "./run-result.js";

/** Raw discovery evidence is not a reusable CapabilityArtifact. */
export interface RunTraceStep {
  id: string;
  observation: Observation;
  action: SurfaceAction;
  result: ActionResult;
  evidence: ReadonlyArray<string>;
}

export interface RunTrace {
  traceId: string;
  goal: string;
  inputs: Readonly<Record<string, unknown>>;
  steps: ReadonlyArray<RunTraceStep>;
  result: RunResult;
  startedAt: string;
  finishedAt: string;
}
