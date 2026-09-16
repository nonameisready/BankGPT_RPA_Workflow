import type { SurfaceAction } from "../actions/action-schema.js";
import type { Checkpoint } from "../capability/artifact-schema.js";

export interface InteractiveControl {
  kind: "link" | "button" | "input" | "select" | "textarea" | "dialog" | "other";
  role?: string | undefined;
  name?: string | undefined;
  label?: string | undefined;
  value?: string | undefined;
  disabled?: boolean | undefined;
  frame?: string | undefined;
}

export interface Observation {
  url: string;
  title: string;
  visibleText: string;
  controls: ReadonlyArray<InteractiveControl>;
  dialogs: ReadonlyArray<{ name?: string | undefined; text: string }>;
  frames: ReadonlyArray<{ name?: string | undefined; url: string }>;
  screenshotPath?: string;
  domHints?: Readonly<Record<string, string>>;
}

export interface ActionResult {
  success: boolean;
  durationMs: number;
  extractedValue?: unknown;
  message?: string | undefined;
  resolution?: { targetId: string; strategyIndex: number; strategyKind: string };
}

export interface SurfaceStartOptions {
  entryUrl: string;
  headed?: boolean;
  timeoutMs?: number;
}

export interface SurfaceAdapter {
  start(options: SurfaceStartOptions): Promise<void>;
  observe(): Promise<Observation>;
  execute(action: SurfaceAction): Promise<ActionResult>;
  check(checkpoint: Checkpoint): Promise<boolean>;
  screenshot(label: string): Promise<string>;
  getSessionId(): string;
  close(): Promise<void>;
}
