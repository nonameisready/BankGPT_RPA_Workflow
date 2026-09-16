import { z } from "zod";
import { ActionTypeSchema, SurfaceActionSchema, TargetSchema } from "../actions/action-schema.js";

export const ARTIFACT_SCHEMA_VERSION = "1.0" as const;

const JsonLiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ValueTypeSchema = z.enum(["string", "number", "integer", "boolean"]);

export const InputDefinitionSchema = z.object({
  type: ValueTypeSchema,
  description: z.string().min(1),
  required: z.boolean().default(true),
  sensitive: z.boolean().default(false),
  pattern: z.string().optional(),
  enum: z.array(JsonLiteralSchema).min(1).optional(),
  default: JsonLiteralSchema.optional(),
}).strict();

export const OutputDefinitionSchema = z.object({
  type: ValueTypeSchema,
  description: z.string().min(1),
  nullable: z.boolean().default(false),
  sensitive: z.boolean().default(false),
}).strict();

export const CheckpointSchema = z.object({
  kind: z.enum(["url", "element_visible", "element_hidden", "text", "output", "business_outcome"]),
  target: TargetSchema.optional(),
  operator: z.enum(["equals", "contains", "matches", "exists", "not_exists"]).optional(),
  expected: JsonLiteralSchema.optional(),
  output: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  timeout_ms: z.number().int().positive().max(60_000).default(10_000),
}).strict();

export const RecoveryPolicySchema = z.object({
  max_attempts: z.number().int().min(1).max(5).default(1),
  backoff_ms: z.number().int().min(0).max(30_000).default(0),
  on_failure: z.enum(["fail", "request_human", "continue"]).default("fail"),
  known_interstitial: z.object({ dismiss_target: TargetSchema }).strict().optional(),
}).strict();

export const CapabilityStepSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  description: z.string().min(1),
  action: SurfaceActionSchema,
  preconditions: z.array(CheckpointSchema).default([]),
  postconditions: z.array(CheckpointSchema).default([]),
  wait: z.object({ before_ms: z.number().int().min(0).max(60_000).default(0), after_ms: z.number().int().min(0).max(60_000).default(0) }).strict().default({ before_ms: 0, after_ms: 0 }),
  recovery: RecoveryPolicySchema.default({ max_attempts: 1, backoff_ms: 0, on_failure: "fail" }),
}).strict();

export const BusinessOutcomeSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  description: z.string().min(1),
  checkpoint: CheckpointSchema,
}).strict();

export const TenantOverrideSchema = z.object({
  tenant: z.string().min(1),
  route_prefix: z.string().optional(),
  locator_overrides: z.record(z.string(), TargetSchema).default({}),
}).strict();

export const CapabilityArtifactSchema = z.object({
  schema_version: z.literal(ARTIFACT_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  approval: z.enum(["draft", "approved", "deprecated"]).default("draft"),
  application: z.object({
    vendor_family: z.string().min(1),
    app_family: z.string().min(1),
    compatible_versions: z.array(z.string().min(1)).min(1),
    variant: z.string().min(1).optional(),
    entry_url: z.string().url(),
    fingerprint_hints: z.record(z.string(), z.string()).default({}),
  }).strict(),
  inputs: z.record(z.string(), InputDefinitionSchema),
  outputs: z.record(z.string(), OutputDefinitionSchema),
  risk: z.enum(["SAFE", "REVERSIBLE", "RISKY", "IRREVERSIBLE"]),
  policy: z.object({
    allowed_domains: z.array(z.string().min(1)).min(1),
    allowed_route_patterns: z.array(z.string().min(1)).default([]),
    allowed_actions: z.array(ActionTypeSchema).min(1),
    risky_action_behavior: z.enum(["BLOCK", "REQUIRE_HUMAN", "REQUIRE_EXPLICIT_APPROVAL"]).default("BLOCK"),
  }).strict(),
  steps: z.array(CapabilityStepSchema).min(1),
  success: z.array(CheckpointSchema).min(1),
  business_outcomes: z.array(BusinessOutcomeSchema).default([]),
  tenant_overrides: z.array(TenantOverrideSchema).default([]),
  metadata: z.object({
    created_at: z.string().datetime(),
    created_by: z.string().min(1),
    source_trace_id: z.string().min(1).optional(),
    description_notes: z.array(z.string()).default([]),
    contains_secrets: z.literal(false),
  }).strict(),
}).strict().superRefine((artifact, context) => {
  const stepIds = new Set<string>();
  for (const [index, step] of artifact.steps.entries()) {
    if (stepIds.has(step.id)) {
      context.addIssue({ code: "custom", path: ["steps", index, "id"], message: `Duplicate step id: ${step.id}` });
    }
    stepIds.add(step.id);

    if (!artifact.policy.allowed_actions.includes(step.action.action)) {
      context.addIssue({ code: "custom", path: ["steps", index, "action", "action"], message: `Action ${step.action.action} is not allowed by artifact policy` });
    }
    for (const [field, value] of Object.entries(step.action)) {
      if (value && typeof value === "object" && "from_input" in value && typeof value.from_input === "string" && !Object.hasOwn(artifact.inputs, value.from_input)) {
        context.addIssue({ code: "custom", path: ["steps", index, "action", field], message: `Undeclared input: ${value.from_input}` });
      }
    }
    if (step.action.action === "extract" && !Object.hasOwn(artifact.outputs, step.action.output)) {
      context.addIssue({ code: "custom", path: ["steps", index, "action", "output"], message: `Undeclared output: ${step.action.output}` });
    }
  }
  for (const [index, checkpoint] of artifact.success.entries()) {
    if (checkpoint.kind === "output" && (!checkpoint.output || !Object.hasOwn(artifact.outputs, checkpoint.output))) {
      context.addIssue({ code: "custom", path: ["success", index, "output"], message: "Success output checkpoint must name a declared output" });
    }
  }
});

export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>;
export type CapabilityStep = z.infer<typeof CapabilityStepSchema>;
export type Checkpoint = z.infer<typeof CheckpointSchema>;
