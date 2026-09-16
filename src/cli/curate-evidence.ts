import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const categories = ["discovery", "replay-success", "replay-business-outcome", "replay-hard-failure-permission", "replay-hard-failure-app", "handoff"] as const;
type Category = typeof categories[number];
const root = process.cwd();
const evidenceRoot = join(root, "evidence");

function runIdFor(category: Category): string {
  const index = process.argv.indexOf(`--${category}`);
  const runId = process.argv[index + 1];
  if (index < 0 || !runId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(runId)) throw new Error(`Missing or invalid --${category} run ID`);
  return runId;
}

function sourceMode(category: Category): "discovery" | "replay" { return category === "discovery" ? "discovery" : "replay"; }

function rewriteReferences(value: unknown, originalDirectory: string, curatedDirectory: string): unknown {
  if (typeof value === "string") {
    if (value.startsWith(`${originalDirectory}${sep}`)) return relative(root, join(curatedDirectory, value.slice(originalDirectory.length + 1))).split(sep).join("/");
    if (value.startsWith(`${root}${sep}`)) return relative(root, value).split(sep).join("/");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteReferences(item, originalDirectory, curatedDirectory));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteReferences(item, originalDirectory, curatedDirectory)]));
  return value;
}

function verifySanitized(text: string, path: string): void {
  const forbidden = [/\/Users\//i, /\/private\/tmp\//i, /Qwen3\.5-35B-A3B-4bit/i, /(?:api[_-]?key|authorization|cookie|storage[_-]?state|password|credential)\s*[":=]\s*(?!\[REDACTED\])/i, /Bearer\s+(?:local|sk-[A-Za-z0-9]+)/i];
  if (forbidden.some((pattern) => pattern.test(text))) throw new Error(`Potential secret or absolute path in curated evidence: ${path}`);
}

async function curate(category: Category): Promise<string> {
  const runId = runIdFor(category);
  const originalDirectory = resolve(evidenceRoot, sourceMode(category), `run-${runId}`);
  const curatedDirectory = resolve(evidenceRoot, "submission", category, `run-${runId}`);
  if (!(await stat(originalDirectory)).isDirectory()) throw new Error(`Source run is not a directory: ${runId}`);
  await mkdir(resolve(evidenceRoot, "submission", category), { recursive: true });
  await cp(originalDirectory, curatedDirectory, { recursive: true, force: true, errorOnExist: false });
  const eventsPath = join(curatedDirectory, "events.jsonl");
  const sourceEvents = await readFile(eventsPath, "utf8");
  const parsedEvents: Array<{ runId?: string; event?: string; payload?: { status?: string; code?: string } }> = [];
  for (const line of sourceEvents.trim().split("\n")) {
    const event = JSON.parse(line) as { runId?: string; event?: string; payload?: { status?: string; code?: string } };
    if (event.runId !== runId) throw new Error(`Mismatched run ID in ${eventsPath}`);
    parsedEvents.push(event);
  }
  const expectedEvent = category === "discovery" ? "finish" : category === "handoff" || category === "replay-success" ? "success" : "terminal_condition";
  if (!parsedEvents.some((event) => event.event === expectedEvent)) throw new Error(`Selected run lacks ${expectedEvent}: ${runId}`);
  if (category === "handoff" && !["intervention_request", "session_paused", "human_takeover", "automation_resumed"].every((name) => parsedEvents.some((event) => event.event === name))) throw new Error(`Selected handoff run lacks ownership evidence: ${runId}`);
  if (category === "replay-business-outcome" && !parsedEvents.some((event) => event.payload?.status === "BUSINESS_OUTCOME")) throw new Error(`Selected run is not a business outcome: ${runId}`);
  if (category.startsWith("replay-hard-failure") && !parsedEvents.some((event) => event.payload?.status === "HARD_FAILURE")) throw new Error(`Selected run is not a hard failure: ${runId}`);
  const events = `${parsedEvents.map((event) => JSON.stringify(rewriteReferences(event, originalDirectory, curatedDirectory))).join("\n")}\n`;
  verifySanitized(events, eventsPath);
  await writeFile(eventsPath, events);
  if (category === "discovery") {
    const tracePath = join(curatedDirectory, "trace.json");
    const trace = JSON.parse(await readFile(tracePath, "utf8")) as { traceId?: string };
    if (trace.traceId !== runId) throw new Error(`Mismatched discovery trace ID: ${runId}`);
    const rewritten = `${JSON.stringify(rewriteReferences(trace, originalDirectory, curatedDirectory), null, 2)}\n`;
    verifySanitized(rewritten, tracePath);
    await writeFile(tracePath, rewritten);
  }
  const screenshots = await readdir(join(curatedDirectory, "screenshots"));
  if (!screenshots.some((name) => name.endsWith(".png"))) throw new Error(`Selected run lacks screenshots: ${runId}`);
  return relative(root, curatedDirectory).split(sep).join("/");
}

async function main(): Promise<void> {
  const selected = Object.fromEntries(categories.map((category) => [category, runIdFor(category)]));
  const paths: Record<string, string> = {};
  for (const category of categories) {
    paths[category] = await curate(category);
    console.log(paths[category]);
  }
  const manifestPath = resolve(evidenceRoot, "submission", "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify({ generated_at: new Date().toISOString(), runs: selected, paths }, null, 2)}\n`);
  console.log(relative(root, manifestPath).split(sep).join("/"));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Evidence curation failed"); process.exitCode = 1; });
