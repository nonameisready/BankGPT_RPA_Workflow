export interface EvidenceEvent {
  timestamp: string;
  runId: string;
  mode: "discovery" | "replay";
  event: string;
  stepId?: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface EvidenceStore {
  initialize(runId: string, mode: "discovery" | "replay"): Promise<void>;
  append(event: EvidenceEvent): Promise<void>;
  saveScreenshot(sourcePath: string, label: string): Promise<string>;
  references(): ReadonlyArray<string>;
}
