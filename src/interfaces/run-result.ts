export type RunStatus = "SUCCESS" | "BUSINESS_OUTCOME" | "RECOVERABLE" | "HARD_FAILURE" | "HUMAN_REQUIRED";

export interface RunResult {
  runId: string;
  status: RunStatus;
  code: string;
  currentStepId?: string | undefined;
  expectedState?: string;
  observedState?: string;
  outputs: Readonly<Record<string, unknown>>;
  evidence: ReadonlyArray<string>;
  debugMessage?: string | undefined;
}
