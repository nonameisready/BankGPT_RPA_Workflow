export type ControlOwner = "automation" | "human" | "paused";

export interface InterventionRequest {
  interventionId: string;
  runId: string;
  goalOrCapability: string;
  stepId?: string;
  reason: string;
  screenshotPath: string;
  currentUrl: string;
  stateSummary: string;
  requestedAction: string;
  createdAt: string;
}

/** Implementations must retain the same live SurfaceAdapter session. */
export interface SessionControlManager {
  owner(sessionId: string): ControlOwner;
  request(sessionId: string, intervention: InterventionRequest): Promise<void>;
  takeControl(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
}
