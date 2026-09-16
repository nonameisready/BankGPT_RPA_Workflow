import { z } from "zod";

export const LocatorStrategySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("role"), role: z.string().min(1), name: z.string().min(1).optional(), exact: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("label"), value: z.string().min(1), exact: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("text"), value: z.string().min(1), exact: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("css"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("name"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("placeholder"), value: z.string().min(1), exact: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("text_near"), text: z.string().min(1), relation: z.enum(["before", "after", "within"]), selector: z.string().min(1).optional() }).strict(),
  z.object({ kind: z.literal("table_cell"), row_text: z.string().min(1), column_header: z.string().min(1) }).strict(),
]);

export const TargetSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  description: z.string().min(1),
  strategies: z.array(LocatorStrategySchema).min(1),
  frame: z.string().min(1).optional(),
}).strict();

export const InputReferenceSchema = z.object({ from_input: z.string().min(1) }).strict();

export const RuntimeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  InputReferenceSchema,
]);

const StringValueSchema = z.union([z.string().min(1), InputReferenceSchema]);
const UrlValueSchema = z.union([z.url(), InputReferenceSchema]);

export const ActionTypeSchema = z.enum([
  "navigate", "click", "fill", "select", "upload", "wait", "extract", "assert", "request_human", "finish",
]);

const ActionBaseSchema = z.object({ reason: z.string().min(1).optional() });

export const SurfaceActionSchema = z.discriminatedUnion("action", [
  ActionBaseSchema.extend({ action: z.literal("navigate"), url: UrlValueSchema }).strict(),
  ActionBaseSchema.extend({ action: z.literal("click"), target: TargetSchema }).strict(),
  ActionBaseSchema.extend({ action: z.literal("fill"), target: TargetSchema, value: RuntimeValueSchema }).strict(),
  ActionBaseSchema.extend({ action: z.literal("select"), target: TargetSchema, value: RuntimeValueSchema }).strict(),
  ActionBaseSchema.extend({ action: z.literal("upload"), target: TargetSchema, path: StringValueSchema }).strict(),
  ActionBaseSchema.extend({ action: z.literal("wait"), for: z.enum(["timeout", "url", "visible", "hidden", "network_idle"]), timeout_ms: z.number().int().positive().max(60_000), target: TargetSchema.optional(), value: z.string().optional() }).strict(),
  ActionBaseSchema.extend({ action: z.literal("extract"), target: TargetSchema, output: z.string().min(1), transform: z.enum(["text", "number", "currency", "boolean"]).default("text") }).strict(),
  ActionBaseSchema.extend({ action: z.literal("assert"), target: TargetSchema.optional(), condition: z.enum(["visible", "hidden", "text_equals", "text_contains", "url_matches"]), expected: RuntimeValueSchema.optional() }).strict(),
  ActionBaseSchema.extend({ action: z.literal("request_human"), message: z.string().min(1) }).strict(),
  ActionBaseSchema.extend({ action: z.literal("finish"), status: z.enum(["success", "business_outcome", "failure"]), code: z.string().min(1).optional() }).strict(),
]).superRefine((action, context) => {
  if (action.action === "wait") {
    const requiresTarget = action.for === "visible" || action.for === "hidden";
    const requiresValue = action.for === "url";
    if (requiresTarget && !action.target) context.addIssue({ code: "custom", path: ["target"], message: `Wait for ${action.for} requires a target` });
    if (requiresValue && !action.value) context.addIssue({ code: "custom", path: ["value"], message: "Wait for URL requires a value" });
    if (!requiresTarget && action.target) context.addIssue({ code: "custom", path: ["target"], message: `Wait for ${action.for} does not use a target` });
    if (!requiresValue && action.value) context.addIssue({ code: "custom", path: ["value"], message: `Wait for ${action.for} does not use a value` });
  }
  if (action.action === "assert") {
    const requiresTarget = action.condition !== "url_matches";
    const requiresExpected = ["text_equals", "text_contains", "url_matches"].includes(action.condition);
    if (requiresTarget && !action.target) context.addIssue({ code: "custom", path: ["target"], message: `Assert ${action.condition} requires a target` });
    if (!requiresTarget && action.target) context.addIssue({ code: "custom", path: ["target"], message: "URL assertion does not use a target" });
    if (requiresExpected && action.expected === undefined) context.addIssue({ code: "custom", path: ["expected"], message: `Assert ${action.condition} requires an expected value` });
    if (!requiresExpected && action.expected !== undefined) context.addIssue({ code: "custom", path: ["expected"], message: `Assert ${action.condition} does not use an expected value` });
  }
});

export type LocatorStrategy = z.infer<typeof LocatorStrategySchema>;
export type Target = z.infer<typeof TargetSchema>;
export type RuntimeValue = z.infer<typeof RuntimeValueSchema>;
export type SurfaceAction = z.infer<typeof SurfaceActionSchema>;
