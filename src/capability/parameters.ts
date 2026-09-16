import { SurfaceActionSchema, type RuntimeValue, type SurfaceAction } from "../actions/action-schema.js";

export function resolveValue(value: RuntimeValue, inputs: Readonly<Record<string, unknown>>): string | number | boolean | null {
  if (value && typeof value === "object" && "from_input" in value) {
    if (!Object.hasOwn(inputs, value.from_input)) throw new Error(`Missing invocation input: ${value.from_input}`);
    const resolved = inputs[value.from_input];
    if (!["string", "number", "boolean"].includes(typeof resolved) && resolved !== null) throw new Error(`Unsupported invocation input: ${value.from_input}`);
    return resolved as string | number | boolean | null;
  }
  return value;
}

export function resolveActionInputs(action: SurfaceAction, inputs: Readonly<Record<string, unknown>>): SurfaceAction {
  const copy: Record<string, unknown> = { ...action };
  for (const key of ["url", "value", "path", "expected"]) {
    if (key in copy) copy[key] = resolveValue(copy[key] as RuntimeValue, inputs);
  }
  return SurfaceActionSchema.parse(copy);
}
