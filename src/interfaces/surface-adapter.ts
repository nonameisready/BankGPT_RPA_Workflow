import type { SurfaceAction } from "../actions/action-schema.js";

export interface InteractiveControl {
  kind: "link" | "button" | "input" | "select" | "textarea" | "dialog" | "other";
  role?: string;
  name?: string;
  label?: string;
  value?: string;
  disabled?: boolean;
  frame?: string;
}

export interface Observation {
  url: string;
  title: string;
  visibleText: string;
  controls: ReadonlyArray<InteractiveControl>;
  dialogs: ReadonlyArray<{ name?: string; text: string }>;
  frames: ReadonlyArray<{ name?: string; url: string }>;
  screenshotPath?: string;
  domHints?: Readonly<Record<string, string>>;
}

export interface ActionResult {
  success: boolean;
  durationMs: number;
  extractedValue?: unknown;
  message?: string;
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
  screenshot(label: string): Promise<string>;
  getSessionId(): string;
  close(): Promise<void>;
}
