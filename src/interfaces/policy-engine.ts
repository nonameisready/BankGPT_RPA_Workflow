import type { SurfaceAction } from "../actions/action-schema.js";

export interface PolicyContext {
  mode: "discovery" | "replay";
  currentUrl: string;
  capabilityId?: string;
  stepId?: string;
}

export type PolicyDecision =
  | { authorized: true; reason: string }
  | { authorized: false; reason: string; disposition: "BLOCK" | "REQUIRE_HUMAN" | "REQUIRE_EXPLICIT_APPROVAL" };

export interface PolicyEngine {
  authorize(action: SurfaceAction, context: PolicyContext): Promise<PolicyDecision>;
}
