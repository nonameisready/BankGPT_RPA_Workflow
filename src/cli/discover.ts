import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Target } from "../actions/action-schema.js";
import { DiscoveryAgent } from "../agent/discovery-agent.js";
import { CapabilityCompiler } from "../capability/capability-compiler.js";
import { serializeArtifact } from "../capability/serialization.js";
import { JsonlEvidenceStore } from "../evidence/jsonl-evidence-store.js";
import { OpenAICompatibleProvider } from "../llm/openai-compatible-provider.js";
import { ConfigurablePolicyEngine, DEMO_DISCOVERY_POLICY } from "../policy/configurable-policy-engine.js";
import { PlaywrightSurfaceAdapter } from "../surface/playwright-surface-adapter.js";
import { parseArguments, stringFlag } from "./arguments.js";

async function main(): Promise<void> {
  const { flags, inputs } = parseArguments(process.argv.slice(2));
  const goal = stringFlag(flags, "goal", "Look up the member and return the current savings balance and currency");
  const target = stringFlag(flags, "target", "http://localhost:4000");
  const model = OpenAICompatibleProvider.fromEnvironment();
  const sensitiveKeys = new Set(Object.keys(inputs).filter((name) => /password|passwd|secret|token|api[_-]?key|credential/i.test(name)));
  const sensitiveValues = new Set([...sensitiveKeys].map((name) => inputs[name]).filter((value): value is string => Boolean(value)));
  const evidence = new JsonlEvidenceStore(join(process.cwd(), "evidence"), sensitiveKeys, sensitiveValues);
  const agent = new DiscoveryAgent(new PlaywrightSurfaceAdapter(), model, new ConfigurablePolicyEngine(DEMO_DISCOVERY_POLICY), evidence);
  const { trace, result } = await agent.discover({ goal, targetUrl: target, inputs, maxSteps: Number(flags["max-steps"] ?? 12), timeoutMs: Number(flags["timeout-ms"] ?? 600_000), requiredOutputs: ["balance", "currency"] });
  if (result.status !== "SUCCESS") { console.log(JSON.stringify({ ...result, tracePath: join(evidence.directory(), "trace.json") }, null, 2)); process.exitCode = 1; return; }

  const outputTargets: Record<string, Target> = {
    balance: { id: "savings_balance", description: "Savings current balance cell", frame: "Member accounts", strategies: [{ kind: "table_cell", row_text: "Savings", column_header: "Current Balance" }] },
    currency: { id: "savings_currency", description: "Savings currency cell", frame: "Member accounts", strategies: [{ kind: "table_cell", row_text: "Savings", column_header: "Currency" }] },
  };
  const compiler = new CapabilityCompiler();
  const artifact = await compiler.compile(trace, {
    capabilityId: "legacybank.get_savings_balance",
    name: "Get Savings Balance",
    description: "Return a fictional LegacyBank member's savings balance and currency.",
    inputNames: ["member_id"], outputNames: ["balance", "currency"], goalCompletion: "Balance and currency extracted from the Savings account row.",
    application: { vendor_family: "LegacyBank", app_family: "Admin Simulator", compatible_versions: ["7.x"], variant: "training", entry_url: target, fingerprint_hints: { title: "LegacyBank Admin Simulator" } },
    policy: { allowed_domains: ["localhost", "127.0.0.1"], allowed_route_patterns: ["^/$", "^/members(?:/.*)?$"], allowed_actions: ["navigate", "fill", "click", "wait", "extract", "assert"], blocked_target_patterns: ["open new sub-account", "continue to review", "confirm and open"], risky_action_behavior: "BLOCK" },
    risk: "SAFE",
    outputTargets,
    outputTransforms: { balance: "currency", currency: "text" },
    businessOutcomes: [{ code: "MEMBER_NOT_FOUND", description: "Member search returned a known no-record result.", checkpoint: { kind: "business_outcome", target: { id: "member_not_found_alert", description: "Member not found alert", strategies: [{ kind: "role", role: "alert" }] }, code: "MEMBER_NOT_FOUND", expected_text: "Member Not Found", timeout_ms: 10_000 } }],
  });
  const artifactDirectory = join(process.cwd(), "capabilities", "generated");
  await mkdir(artifactDirectory, { recursive: true });
  const artifactPath = join(artifactDirectory, `get-savings-balance-${trace.traceId}.yaml`);
  await writeFile(artifactPath, serializeArtifact(artifact, "yaml"), { flag: "wx" });
  console.log(JSON.stringify({ result, discoveryRunId: result.runId, tracePath: join(evidence.directory(), "trace.json"), artifactPath }, null, 2));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Unknown CLI error"); process.exitCode = 1; });
