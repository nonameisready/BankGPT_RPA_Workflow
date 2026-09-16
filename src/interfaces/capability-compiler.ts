import type { CapabilityArtifact } from "../capability/artifact-schema.js";
import type { RunTrace } from "./run-trace.js";
import type { Target } from "../actions/action-schema.js";
import type { Checkpoint } from "../capability/artifact-schema.js";

export interface CompilationHints {
  capabilityId: string;
  name: string;
  description: string;
  inputNames: ReadonlyArray<string>;
  outputNames: ReadonlyArray<string>;
  goalCompletion: string;
  application: CapabilityArtifact["application"];
  policy: CapabilityArtifact["policy"];
  risk: CapabilityArtifact["risk"];
  outputTargets?: Readonly<Record<string, Target>>;
  outputTransforms?: Readonly<Record<string, "text" | "number" | "currency" | "boolean">>;
  businessOutcomes?: ReadonlyArray<{ code: string; description: string; checkpoint: Checkpoint }>;
  terminalConditions?: ReadonlyArray<CapabilityArtifact["terminal_conditions"][number]>;
}

/** Compiles successful traces, not arbitrary transcripts. */
export interface CapabilityCompiler {
  compile(trace: RunTrace, hints: CompilationHints): Promise<CapabilityArtifact>;
}
