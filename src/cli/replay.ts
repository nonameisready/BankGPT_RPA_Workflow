import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArtifact } from "../capability/serialization.js";
import { JsonlEvidenceStore } from "../evidence/jsonl-evidence-store.js";
import { LiveSessionControlManager } from "../handoff/live-session-control-manager.js";
import { ConfigurablePolicyEngine, policyFromArtifact } from "../policy/configurable-policy-engine.js";
import { ReplayEngine } from "../replay/replay-engine.js";
import { PlaywrightSurfaceAdapter } from "../surface/playwright-surface-adapter.js";
import { parseArguments, stringFlag } from "./arguments.js";

async function main(): Promise<void> {
  const { flags, inputs } = parseArguments(process.argv.slice(2));
  const artifactPath = resolve(stringFlag(flags, "capability"));
  const artifact = parseArtifact(await readFile(artifactPath, "utf8"), artifactPath.endsWith(".json") ? "json" : "yaml");
  const sensitiveKeys = new Set([
    ...Object.entries(artifact.inputs).filter(([, definition]) => definition.sensitive).map(([name]) => name),
    ...Object.entries(artifact.outputs).filter(([, definition]) => definition.sensitive).map(([name]) => name),
  ]);
  const sensitiveValues = new Set([...sensitiveKeys].map((name) => inputs[name]).filter((value): value is string => Boolean(value)));
  const evidence = new JsonlEvidenceStore(join(process.cwd(), "evidence"), sensitiveKeys, sensitiveValues);
  const sessionControl = flags.handoff === true ? new LiveSessionControlManager(async (intervention) => {
    console.log(`\nHUMAN ACTION REQUIRED for ${intervention.runId}.\nUse the SAME open browser window. Click only "Acknowledge and Continue"; do not open another page.\nScreenshot: ${intervention.screenshotPath}\nContext: ${intervention.stateSummary}`);
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { await prompt.question("After dismissing the dialog in that browser window, press Enter to resume: "); }
    finally { prompt.close(); }
  }) : undefined;
  const result = await new ReplayEngine().run({ artifact, inputs, surface: new PlaywrightSurfaceAdapter(), policy: new ConfigurablePolicyEngine(policyFromArtifact(artifact)), evidence, ...(sessionControl ? { sessionControl } : {}), headed: flags.headed === true || flags.handoff === true });
  console.log(JSON.stringify({ result, replayRunId: result.runId, evidencePath: evidence.directory() }, null, 2));
  if (!["SUCCESS", "BUSINESS_OUTCOME"].includes(result.status)) process.exitCode = 1;
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Unknown CLI error"); process.exitCode = 1; });
