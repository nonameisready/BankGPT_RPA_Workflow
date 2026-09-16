import { SurfaceActionSchema, type SurfaceAction } from "../actions/action-schema.js";
import type { Observation } from "./surface-adapter.js";
import { z } from "zod";

export interface AgentDecisionInput {
  goal: string;
  inputs: Readonly<Record<string, unknown>>;
  history: ReadonlyArray<{ action: SurfaceAction; result: ActionResultSummary }>;
  observation: Observation;
  policySummary: string;
  requiredOutputs?: ReadonlyArray<string> | undefined;
}

export interface ActionResultSummary {
  success: boolean;
  message?: string | undefined;
  extractedValue?: unknown;
}

export interface AgentDecision {
  action: SurfaceAction;
}

export const AgentDecisionSchema = z.object({ action: SurfaceActionSchema }).strict();

/** Discovery-plane dependency. Never pass this interface to ReplayEngine. */
export interface LLMProvider {
  decide(input: AgentDecisionInput): Promise<AgentDecision>;
}
