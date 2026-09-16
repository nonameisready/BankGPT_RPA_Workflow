import type { SurfaceAction } from "../actions/action-schema.js";
import type { CapabilityArtifact } from "../capability/artifact-schema.js";
import type { PolicyContext, PolicyDecision, PolicyEngine } from "../interfaces/policy-engine.js";

export interface PolicyConfig {
  allowedDomains: ReadonlyArray<string>;
  allowedRoutePatterns: ReadonlyArray<string>;
  allowedActions: ReadonlyArray<SurfaceAction["action"]>;
  blockedTargetPatterns: ReadonlyArray<string>;
  risk: CapabilityArtifact["risk"];
  riskyActionBehavior: CapabilityArtifact["policy"]["risky_action_behavior"];
}

export const DEMO_DISCOVERY_POLICY: PolicyConfig = {
  allowedDomains: ["localhost", "127.0.0.1"],
  allowedRoutePatterns: ["^/$", "^/members(?:/.*)?$"],
  allowedActions: ["navigate", "click", "fill", "select", "wait", "extract", "assert", "request_human", "finish"],
  blockedTargetPatterns: ["open new sub-account", "continue to review", "confirm and open"],
  risk: "SAFE",
  riskyActionBehavior: "BLOCK",
};

export function policyFromArtifact(artifact: CapabilityArtifact): PolicyConfig {
  return {
    allowedDomains: artifact.policy.allowed_domains,
    allowedRoutePatterns: artifact.policy.allowed_route_patterns,
    allowedActions: artifact.policy.allowed_actions,
    blockedTargetPatterns: artifact.policy.blocked_target_patterns,
    risk: artifact.risk,
    riskyActionBehavior: artifact.policy.risky_action_behavior,
  };
}

export class ConfigurablePolicyEngine implements PolicyEngine {
  constructor(private readonly config: PolicyConfig) {}

  async authorize(action: SurfaceAction, context: PolicyContext): Promise<PolicyDecision> {
    if (!this.config.allowedActions.includes(action.action)) return { authorized: false, reason: `Action type ${action.action} not allowlisted`, disposition: "BLOCK" };
    if ("target" in action && action.target) {
      const targetSummary = `${action.target.description} ${action.target.strategies.map((strategy) => "name" in strategy ? strategy.name : "value" in strategy ? strategy.value : "").join(" ")}`;
      if (this.config.blockedTargetPatterns.some((pattern) => new RegExp(pattern, "i").test(targetSummary))) {
        return { authorized: false, reason: `Target ${action.target.id} blocked by policy`, disposition: "BLOCK" };
      }
    }
    let url: URL;
    try {
      const candidate = action.action === "navigate" ? action.url : context.currentUrl;
      if (typeof candidate !== "string") return { authorized: false, reason: "Navigation URL must be resolved before policy check", disposition: "BLOCK" };
      url = new URL(candidate);
    } catch { return { authorized: false, reason: "Invalid target URL", disposition: "BLOCK" }; }
    if (!["http:", "https:"].includes(url.protocol)) return { authorized: false, reason: `Protocol ${url.protocol} not allowed`, disposition: "BLOCK" };
    if (!this.config.allowedDomains.includes(url.hostname)) return { authorized: false, reason: `Domain ${url.hostname} not allowlisted`, disposition: "BLOCK" };
    if (this.config.allowedRoutePatterns.length && !this.config.allowedRoutePatterns.some((pattern) => new RegExp(pattern).test(url.pathname))) {
      return { authorized: false, reason: `Route ${url.pathname} not allowlisted`, disposition: "BLOCK" };
    }
    if (["RISKY", "IRREVERSIBLE"].includes(this.config.risk) && ["click", "select", "upload"].includes(action.action)) {
      const disposition = this.config.riskyActionBehavior;
      return { authorized: false, reason: `${this.config.risk} action requires ${disposition}`, disposition };
    }
    return { authorized: true, reason: "Domain, route, action, and risk policy passed" };
  }
}
