import type { CapabilityArtifact } from "../capability/artifact-schema.js";
import type { RunTrace } from "./run-trace.js";

export interface CompilationHints {
  capabilityId: string;
  name: string;
  description: string;
  inputNames: ReadonlyArray<string>;
  outputNames: ReadonlyArray<string>;
  goalCompletion: string;
}

/** Compiles successful traces, not arbitrary transcripts. */
export interface CapabilityCompiler {
  compile(trace: RunTrace, hints: CompilationHints): Promise<CapabilityArtifact>;
}
