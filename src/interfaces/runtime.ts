import type { CapabilityArtifact } from "../capability/artifact-schema.js";
import type { EvidenceStore } from "./evidence-store.js";
import type { PolicyEngine } from "./policy-engine.js";
import type { RunResult } from "./run-result.js";
import type { SurfaceAdapter } from "./surface-adapter.js";
import type { RunTrace } from "./run-trace.js";

export interface DiscoveryRequest {
  goal: string;
  targetUrl: string;
  inputs?: Readonly<Record<string, unknown>>;
  maxSteps: number;
  timeoutMs: number;
  requiredOutputs?: ReadonlyArray<string>;
}

export interface DiscoveryAgent {
  discover(request: DiscoveryRequest): Promise<{ trace: RunTrace; result: RunResult }>;
}

export interface ReplayRequest {
  artifact: CapabilityArtifact;
  inputs: Readonly<Record<string, unknown>>;
  surface: SurfaceAdapter;
  policy: PolicyEngine;
  evidence: EvidenceStore;
}

/** Execution-plane interface: intentionally has no LLMProvider dependency. */
export interface ReplayEngine {
  run(request: ReplayRequest): Promise<RunResult>;
}
