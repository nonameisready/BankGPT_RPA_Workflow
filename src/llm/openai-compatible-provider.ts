import { z } from "zod";
import { AgentDecisionSchema, type AgentDecision, type AgentDecisionInput, type LLMProvider } from "../interfaces/llm-provider.js";

const CompletionResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }).passthrough() }).passthrough()).min(1),
}).passthrough();

export interface OpenAICompatibleConfig {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  jsonMode?: boolean;
}

const SYSTEM_PROMPT = `You are a constrained computer-use discovery agent. Return ONLY one JSON action object. Do not output code, markdown, or hidden reasoning. Choose exactly one action based on the current observation. Use concise reason only. Every target MUST be {"id":"stable_snake_case","description":"human-readable","strategies":[{"kind":"role","role":"textbox","name":"visible accessible name"}]}, optionally with "frame":"iframe title". Never use {"role":...,"name":...} directly as target. Prefer role and label locators. For legacy account tables use {"kind":"table_cell","row_text":"visible row type","column_header":"visible header"} rather than CSS or test IDs. Action choices: navigate(url), click(target), fill(target,value), select(target,value), upload(target,path), wait(for,timeout_ms,target/value if required), extract(target,output,transform), assert(condition,target/expected if required), request_human(message), finish(status,code). Every extract MUST have one string "output" name and one target cell; never extract multiple fields in one action. "transform" must be exactly one of text, number, currency, boolean. Example fill: {"action":"fill","target":{"id":"customer_id_field","description":"Customer ID field","strategies":[{"kind":"label","value":"Customer ID"}]},"value":{"from_input":"customer_id"},"reason":"Search form is ready"}. Parameterize invocation values with {"from_input":"input_name"}; do not hardcode caller-provided values. Extract declared outputs before finishing. Never open or submit a financial account; read-only tasks only. If a known business result is visible, finish with business_outcome and an uppercase code. Never invent controls or values not shown in observation.`;

function normalizeTarget(raw: unknown, fallback: string): unknown {
  if (typeof raw === "string") return { id: fallback.replace(/[^a-z0-9]+/gi, "_").toLowerCase(), description: raw, strategies: [{ kind: "label", value: raw }] };
  if (!raw || typeof raw !== "object") return raw;
  const target = raw as Record<string, unknown>;
  const description = String(target.description ?? target.name ?? target.label ?? fallback);
  const id = String(target.id ?? description).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const strategies: unknown[] = Array.isArray(target.strategies) ? target.strategies.map(normalizeStrategy) : [];
  if (!strategies.length && typeof target.row_text === "string" && typeof target.column_header === "string") strategies.push({ kind: "table_cell", row_text: target.row_text, column_header: target.column_header });
  if (!strategies.length && typeof target.role === "string") strategies.push({ kind: "role", role: target.role, ...(typeof target.name === "string" ? { name: target.name } : {}) });
  if (!strategies.length && typeof target.label === "string") strategies.push({ kind: "label", value: target.label });
  if (!strategies.length && typeof target.css === "string") strategies.push({ kind: "css", value: target.css });
  if (!strategies.length && typeof target.text === "string") strategies.push({ kind: "text", value: target.text });
  return { id, description, strategies, ...(typeof target.frame === "string" ? { frame: target.frame } : {}) };
}

const ROLE_ALIASES = new Set(["button", "textbox", "link", "cell", "row", "table", "heading", "alert", "dialog", "combobox"]);

function normalizeStrategy(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const strategy = raw as Record<string, unknown>;
  const kind = strategy.kind;
  if (typeof kind === "string" && ROLE_ALIASES.has(kind)) return { kind: "role", role: kind, ...(typeof strategy.name === "string" ? { name: strategy.name } : {}) };
  if ((kind === "accessibility" || kind === undefined) && typeof strategy.role === "string") return { kind: "role", role: strategy.role, ...(typeof strategy.name === "string" ? { name: strategy.name } : {}) };
  return raw;
}

function normalizeDecision(raw: unknown, requiredOutputs: ReadonlyArray<string> = []): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const candidate = raw as Record<string, unknown>;
  const action = typeof candidate.action === "string" ? { ...candidate } : candidate.action && typeof candidate.action === "object" ? { ...(candidate.action as Record<string, unknown>) } : null;
  if (!action) return raw;
  if (action.action === "finish") return { action: { action: "finish", status: action.status, ...(typeof action.code === "string" ? { code: action.code } : {}), ...(typeof action.reason === "string" ? { reason: action.reason } : {}) } };
  if ("target" in action) action.target = normalizeTarget(action.target, String(action.output ?? action.action ?? "target"));
  if (action.action === "extract" && action.transform === "extract_value") action.transform = "text";
  if (action.action === "extract" && typeof action.output !== "string" && action.target && typeof action.target === "object") {
    const target = action.target as { description?: string; strategies?: Array<{ column_header?: string }> };
    const hint = `${target.strategies?.[0]?.column_header ?? ""} ${target.description ?? ""}`.toLowerCase();
    const matched = requiredOutputs.find((name) => hint.includes(name.toLowerCase()));
    if (matched) action.output = matched;
  }
  return { action };
}

export class OpenAICompatibleProvider implements LLMProvider {
  constructor(private readonly config: OpenAICompatibleConfig) {
    if (!config.baseUrl || !config.model) throw new Error("LLM base URL and model are required");
    const host = new URL(config.baseUrl).hostname;
    if (!config.apiKey && !["localhost", "127.0.0.1"].includes(host)) throw new Error("API key required for non-local LLM endpoint");
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): OpenAICompatibleProvider {
    const localQwen = Boolean(environment.QWEN_BASE_URL && environment.QWEN_MODEL);
    const baseUrl = localQwen ? environment.QWEN_BASE_URL : environment.OPENAI_BASE_URL;
    const model = localQwen ? environment.QWEN_MODEL : environment.OPENAI_MODEL;
    if (!baseUrl || !model) throw new Error("Configure QWEN_BASE_URL + QWEN_MODEL or OPENAI_BASE_URL + OPENAI_MODEL in .env");
    return new OpenAICompatibleProvider({ baseUrl, model, apiKey: localQwen ? "local" : environment.OPENAI_API_KEY, jsonMode: environment.OPENAI_JSON_MODE !== "false" });
  }

  async decide(input: AgentDecisionInput): Promise<AgentDecision> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.config.model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ goal: input.goal, inputs: input.inputs, required_outputs: input.requiredOutputs ?? [], history: input.history.slice(-8), observation: input.observation, policy_summary: input.policySummary }) },
      ],
    };
    if (this.config.jsonMode !== false) body.response_format = { type: "json_object" };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`LLM endpoint returned HTTP ${response.status}`);
    const completion = CompletionResponseSchema.parse(await response.json());
    const content = completion.choices[0]?.message.content;
    if (!content) throw new Error("LLM response had no content");
    const clean = content.trim().replace(/^<think>[\s\S]*?<\/think>\s*/i, "").replace(/^```(?:json)?\s*|\s*```$/g, "");
    const candidate: unknown = JSON.parse(clean);
    const normalized = normalizeDecision(candidate, input.requiredOutputs);
    const parsed = AgentDecisionSchema.safeParse(normalized);
    if (!parsed.success) {
      const outer = normalized as { action?: { action?: string; target?: { strategies?: Array<{ kind?: string }> } } };
      const kinds = outer.action?.target?.strategies?.map((strategy) => strategy.kind ?? "missing") ?? [];
      const transform = String((outer.action as { transform?: unknown } | undefined)?.transform ?? "none").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
      throw new Error(`Invalid LLM decision shape: action=${outer.action?.action ?? "missing"}, strategyKinds=${kinds.join(",") || "none"}, transform=${transform}, issues=${parsed.error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`).join(",")}`);
    }
    return parsed.data;
  }
}
