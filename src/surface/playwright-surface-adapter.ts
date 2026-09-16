import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from "playwright";
import type { SurfaceAction, RuntimeValue } from "../actions/action-schema.js";
import type { Checkpoint } from "../capability/artifact-schema.js";
import type { ActionResult, InteractiveControl, Observation, SurfaceAdapter, SurfaceStartOptions } from "../interfaces/surface-adapter.js";
import { resolveLocator } from "./locator-resolver.js";

function literal(value: RuntimeValue): string {
  if (value && typeof value === "object" && "from_input" in value) throw new Error(`Unresolved input reference: ${value.from_input}`);
  return value === null ? "" : String(value);
}

function compare(observed: string, operator: "equals" | "contains" | "matches", expected: string, caseInsensitive = false): boolean {
  const actual = observed.replace(/\s+/g, " ").trim();
  const wanted = expected.replace(/\s+/g, " ").trim();
  if (operator === "matches") return new RegExp(expected, caseInsensitive ? "i" : "").test(actual);
  if (operator === "equals") return caseInsensitive ? actual.toLowerCase() === wanted.toLowerCase() : actual === wanted;
  return caseInsensitive ? actual.toLowerCase().includes(wanted.toLowerCase()) : actual.includes(wanted);
}

// A string avoids transpiler helper functions leaking into the browser realm.
const DOCUMENT_SUMMARY_SCRIPT = String.raw`(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && element.getBoundingClientRect().width > 0;
  };
  const controls = Array.from(document.querySelectorAll("a,button,input,select,textarea,[role=dialog]"))
    .filter(visible)
    .slice(0, 100)
    .map((element) => {
      const tag = element.tagName.toLowerCase();
      const labels = element.labels ? Array.from(element.labels).map((label) => label.innerText.trim()).join(" ") : "";
      const kind = tag === "a" ? "link" : tag === "button" ? "button" : tag === "input" ? "input" : tag === "select" ? "select" : tag === "textarea" ? "textarea" : "dialog";
      return { kind, role: element.getAttribute("role") ?? undefined, name: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 120) ?? undefined, label: labels || undefined, value: element.type === "password" ? undefined : element.value?.slice(0, 120), disabled: element.disabled };
    });
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).map((element) => ({ name: element.getAttribute("aria-label") ?? undefined, text: element.textContent?.trim().slice(0, 500) ?? "" }));
  return { text: document.body?.innerText?.slice(0, 8_000) ?? "", controls, dialogs };
})()`;

async function documentSummary(page: Page | Frame): Promise<{ text: string; controls: InteractiveControl[]; dialogs: { name?: string | undefined; text: string }[] }> {
  return await page.evaluate(DOCUMENT_SUMMARY_SCRIPT) as { text: string; controls: InteractiveControl[]; dialogs: { name?: string | undefined; text: string }[] };
}

export class PlaywrightSurfaceAdapter implements SurfaceAdapter {
  private readonly sessionId = randomUUID();
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private screenshotDirectory: string | undefined;

  constructor(private readonly channel = process.env.PLAYWRIGHT_CHANNEL) {}

  getSessionId(): string { return this.sessionId; }

  private activePage(): Page {
    if (!this.page) throw new Error("Surface session has not started");
    return this.page;
  }

  async start(options: SurfaceStartOptions): Promise<void> {
    if (this.page) throw new Error("Surface session already started");
    const launchOptions = this.channel === "chrome" ? { channel: "chrome" as const, headless: !options.headed } : { headless: !options.headed };
    this.browser = await chromium.launch(launchOptions);
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(options.timeoutMs ?? 15_000);
    await this.page.goto(options.entryUrl, { waitUntil: "domcontentloaded" });
    this.screenshotDirectory = await mkdtemp(join(tmpdir(), "capability-surface-"));
  }

  async observe(): Promise<Observation> {
    const page = this.activePage();
    const main = await documentSummary(page);
    const frames: { name?: string | undefined; url: string }[] = [];
    const controls = [...main.controls];
    const dialogs = [...main.dialogs];
    let visibleText = main.text;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const summary = await documentSummary(frame);
        const frameName = await frame.frameElement().then((element) => element.getAttribute("title"));
        frames.push({ name: frameName ?? undefined, url: frame.url() });
        visibleText += `\n[Frame: ${frameName ?? frame.url()}]\n${summary.text}`;
        controls.push(...summary.controls.map((control) => ({ ...control, frame: frameName ?? undefined })));
        dialogs.push(...summary.dialogs);
      } catch { frames.push({ url: frame.url() }); }
    }
    return { url: page.url(), title: await page.title(), visibleText: visibleText.slice(0, 12_000), controls, dialogs, frames };
  }

  async screenshot(label: string): Promise<string> {
    const page = this.activePage();
    if (!this.screenshotDirectory) throw new Error("Screenshot directory not initialized");
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
    const path = join(this.screenshotDirectory, `${Date.now()}-${safeLabel}.png`);
    await page.screenshot({ path, fullPage: true });
    return path;
  }

  async execute(action: SurfaceAction): Promise<ActionResult> {
    const page = this.activePage();
    const started = Date.now();
    try {
      if (action.action === "navigate") await page.goto(literal(action.url), { waitUntil: "domcontentloaded" });
      else if (action.action === "wait") {
        if (action.for === "timeout") await page.waitForTimeout(action.timeout_ms);
        else if (action.for === "network_idle") await page.waitForLoadState("networkidle", { timeout: action.timeout_ms });
        else if (action.for === "url") await page.waitForURL(action.value!, { timeout: action.timeout_ms });
        else {
          const resolved = await resolveLocator(page, action.target!, action.timeout_ms);
          if (action.for === "visible" && !resolved) throw new Error(`Target not visible: ${action.target!.id}`);
          if (action.for === "hidden" && resolved) await resolved.locator.waitFor({ state: "hidden", timeout: action.timeout_ms });
        }
      } else if (action.action === "assert") {
        const checkpoint: Checkpoint = action.condition === "url_matches"
          ? { kind: "url", operator: "matches", expected: literal(action.expected!), timeout_ms: 10_000 }
          : action.condition === "visible" || action.condition === "hidden"
            ? { kind: action.condition === "visible" ? "element_visible" : "element_hidden", target: action.target!, timeout_ms: 10_000 }
            : { kind: "text", target: action.target!, operator: action.condition === "text_equals" ? "equals" : "contains", expected: literal(action.expected!), timeout_ms: 10_000 };
        if (!await this.check(checkpoint)) throw new Error(`Assertion failed: ${action.condition}`);
      } else if (action.action === "request_human") return { success: false, durationMs: Date.now() - started, message: action.message };
      else if (action.action === "finish") return { success: true, durationMs: Date.now() - started, message: action.code ?? action.status };
      else {
        const resolution = await resolveLocator(page, action.target);
        if (!resolution) throw new Error(`Locator not found or ambiguous: ${action.target.id}`);
        const locator = resolution.locator;
        const evidence = { targetId: resolution.targetId, strategyIndex: resolution.strategyIndex, strategyKind: resolution.strategyKind };
        if (action.action === "click") await locator.click();
        else if (action.action === "fill") await locator.fill(literal(action.value));
        else if (action.action === "select") await locator.selectOption(literal(action.value));
        else if (action.action === "upload") await locator.setInputFiles(literal(action.path));
        else if (action.action === "extract") {
          const raw = (await locator.innerText()).trim();
          const extractedValue = action.transform === "currency" || action.transform === "number"
            ? Number(raw.replace(/[^0-9.-]/g, ""))
            : action.transform === "boolean" ? raw.toLowerCase() === "true" : raw;
          if (typeof extractedValue === "number" && !Number.isFinite(extractedValue)) throw new Error(`Invalid numeric output: ${action.output}`);
          return { success: true, durationMs: Date.now() - started, extractedValue, resolution: evidence };
        }
        return { success: true, durationMs: Date.now() - started, resolution: evidence };
      }
      return { success: true, durationMs: Date.now() - started };
    } catch (error) {
      return { success: false, durationMs: Date.now() - started, message: error instanceof Error ? error.message.slice(0, 500) : "Unknown surface error" };
    }
  }

  async check(checkpoint: Checkpoint): Promise<boolean> {
    const page = this.activePage();
    if (checkpoint.kind === "output") throw new Error("Output checkpoints are checked by ReplayEngine");
    if (checkpoint.kind === "url") return compare(page.url(), checkpoint.operator, checkpoint.expected);
    const resolution = await resolveLocator(page, checkpoint.target, checkpoint.kind === "business_outcome" ? 300 : checkpoint.timeout_ms);
    if (checkpoint.kind === "element_hidden") return !resolution;
    if (!resolution) return false;
    if (checkpoint.kind === "element_visible") return true;
    const text = (await resolution.locator.innerText()).trim();
    if (checkpoint.kind === "business_outcome") return compare(text, "contains", checkpoint.expected_text, true);
    return compare(text, checkpoint.operator, checkpoint.expected, true);
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    if (this.screenshotDirectory) await rm(this.screenshotDirectory, { recursive: true, force: true });
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
    this.screenshotDirectory = undefined;
  }
}
