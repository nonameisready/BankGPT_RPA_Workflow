export interface CliArguments {
  flags: Readonly<Record<string, string | boolean>>;
  inputs: Readonly<Record<string, string>>;
}

export function parseArguments(args: ReadonlyArray<string>): CliArguments {
  const flags: Record<string, string | boolean> = {};
  const inputs: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!key?.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    if (key === "--headed" || key === "--handoff") { flags[key.slice(2)] = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (key === "--input") {
      const separator = value.indexOf("=");
      if (separator < 1) throw new Error("Input must be name=value");
      inputs[value.slice(0, separator)] = value.slice(separator + 1);
    } else flags[key.slice(2)] = value;
  }
  return { flags, inputs };
}

export function stringFlag(flags: CliArguments["flags"], name: string, fallback?: string): string {
  const value = flags[name] ?? fallback;
  if (typeof value !== "string") throw new Error(`Missing --${name}`);
  return value;
}
