import { appendFile, copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvidenceEvent, EvidenceStore } from "../interfaces/evidence-store.js";
import type { RunTrace } from "../interfaces/run-trace.js";
import { redact } from "../policy/redaction.js";

export class JsonlEvidenceStore implements EvidenceStore {
  private runDirectory?: string;
  private readonly savedReferences: string[] = [];

  constructor(
    private readonly root: string,
    private readonly sensitiveKeys: ReadonlySet<string> = new Set(),
    private readonly sensitiveValues: ReadonlySet<string> = new Set(),
  ) {}

  directory(): string {
    if (!this.runDirectory) throw new Error("Evidence store not initialized");
    return this.runDirectory;
  }

  async initialize(runId: string, mode: "discovery" | "replay"): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("Unsafe run id");
    this.runDirectory = join(this.root, mode, `run-${runId}`);
    await mkdir(join(this.runDirectory, "screenshots"), { recursive: true });
    const eventsPath = join(this.runDirectory, "events.jsonl");
    await writeFile(eventsPath, "", { flag: "wx" });
    this.savedReferences.push(eventsPath);
  }

  async append(event: EvidenceEvent): Promise<void> {
    const line = JSON.stringify(redact(event, this.sensitiveKeys, this.sensitiveValues));
    await appendFile(join(this.directory(), "events.jsonl"), `${line}\n`);
  }

  async saveScreenshot(sourcePath: string, label: string): Promise<string> {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
    const destination = join(this.directory(), "screenshots", `${Date.now()}-${safeLabel}.png`);
    await copyFile(sourcePath, destination);
    this.savedReferences.push(destination);
    return destination;
  }

  async saveTrace(trace: RunTrace): Promise<string> {
    const destination = join(this.directory(), "trace.json");
    await writeFile(destination, `${JSON.stringify(redact(trace, this.sensitiveKeys, this.sensitiveValues), null, 2)}\n`, { flag: "wx" });
    this.savedReferences.push(destination);
    return destination;
  }

  references(): ReadonlyArray<string> { return [...this.savedReferences]; }
}
