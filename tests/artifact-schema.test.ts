import { describe, expect, it } from "vitest";
import { CapabilityArtifactSchema } from "../src/capability/artifact-schema.js";
import { parseArtifact, serializeArtifact } from "../src/capability/serialization.js";
import { readFileSync } from "node:fs";
import { SurfaceActionSchema } from "../src/actions/action-schema.js";

const artifact = {
  schema_version: "1.0",
  id: "legacybank.get_savings_balance",
  version: "1.0.0",
  name: "Get savings balance",
  description: "Returns the current savings balance for a fake LegacyBank member.",
  application: {
    vendor_family: "LegacyBank",
    app_family: "Admin Simulator",
    compatible_versions: ["7.x"],
    entry_url: "http://localhost:4000",
  },
  inputs: { member_id: { type: "string", description: "Fake member identifier" } },
  outputs: {
    balance: { type: "number", description: "Current balance" },
    currency: { type: "string", description: "ISO currency code" },
  },
  risk: "SAFE",
  policy: {
    allowed_domains: ["localhost"],
    allowed_route_patterns: ["^/members"],
    allowed_actions: ["navigate", "fill", "click", "extract", "assert"],
  },
  steps: [{
    id: "enter_member_id",
    description: "Enter the requested member ID",
    action: {
      action: "fill",
      target: { description: "Member ID field", strategies: [{ kind: "label", value: "Member ID" }] },
      value: { from_input: "member_id" },
    },
  }],
  success: [{ kind: "output", output: "balance", operator: "exists" }],
  metadata: { created_at: "2026-09-15T00:00:00.000Z", created_by: "test", contains_secrets: false },
};

describe("CapabilityArtifactSchema", () => {
  it("parses a typed, parameterized artifact and applies bounded defaults", () => {
    const parsed = CapabilityArtifactSchema.parse(artifact);
    expect(parsed.steps[0]?.action).toMatchObject({ value: { from_input: "member_id" } });
    expect(parsed.steps[0]?.recovery.max_attempts).toBe(1);
    expect(parsed.approval).toBe("draft");
  });

  it("rejects duplicate step IDs", () => {
    const duplicate = { ...artifact, steps: [artifact.steps[0], artifact.steps[0]] };
    expect(() => CapabilityArtifactSchema.parse(duplicate)).toThrow(/Duplicate step id/);
  });

  it("rejects unknown artifact fields", () => {
    expect(() => CapabilityArtifactSchema.parse({ ...artifact, secret: "nope" })).toThrow();
  });

  it("round trips through YAML and JSON after validation", () => {
    const parsed = CapabilityArtifactSchema.parse(artifact);
    for (const format of ["yaml", "json"] as const) {
      expect(parseArtifact(serializeArtifact(parsed, format), format)).toEqual(parsed);
    }
  });

  it("rejects input references and actions outside declared policy", () => {
    const invalid = {
      ...artifact,
      policy: { ...artifact.policy, allowed_actions: ["click"] },
      steps: [{ ...artifact.steps[0], action: { ...artifact.steps[0]?.action, value: { from_input: "secret_id" } } }],
    };
    expect(() => CapabilityArtifactSchema.parse(invalid)).toThrow();
  });

  it("validates the human-reviewable YAML draft example", () => {
    const source = readFileSync(new URL("../capabilities/get-savings-balance.example.yaml", import.meta.url), "utf8");
    expect(parseArtifact(source, "yaml").id).toBe("legacybank.get_savings_balance");
  });

  it("rejects ambiguous wait and assert actions", () => {
    expect(SurfaceActionSchema.safeParse({ action: "wait", for: "visible", timeout_ms: 1000 }).success).toBe(false);
    expect(SurfaceActionSchema.safeParse({ action: "assert", condition: "text_equals", target: { description: "value", strategies: [{ kind: "text", value: "value" }] } }).success).toBe(false);
    expect(SurfaceActionSchema.safeParse({ action: "navigate", url: 42 }).success).toBe(false);
  });
});
