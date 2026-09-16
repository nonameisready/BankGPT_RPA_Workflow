import type { ControlOwner, InterventionRequest, SessionControlManager } from "../interfaces/session-control.js";

/** State changes refer to one existing browser session; this manager never launches a replacement. */
export class LiveSessionControlManager implements SessionControlManager {
  private readonly states = new Map<string, ControlOwner>();
  private readonly interventions = new Map<string, InterventionRequest>();

  constructor(private readonly operatorAction: (intervention: InterventionRequest) => Promise<void>) {}

  owner(sessionId: string): ControlOwner { return this.states.get(sessionId) ?? "automation"; }

  async request(sessionId: string, intervention: InterventionRequest): Promise<void> {
    if (this.owner(sessionId) !== "automation") throw new Error("Only automation can request intervention");
    if (!intervention.screenshotPath || !intervention.currentUrl) throw new Error("Intervention requires screenshot and current URL");
    this.interventions.set(sessionId, intervention);
    this.states.set(sessionId, "paused");
  }

  async takeControl(sessionId: string): Promise<void> {
    if (this.owner(sessionId) !== "paused") throw new Error("Session must be paused before human takeover");
    this.states.set(sessionId, "human");
  }

  async awaitHumanAction(sessionId: string): Promise<void> {
    if (this.owner(sessionId) !== "human") throw new Error("Human does not own this session");
    const intervention = this.interventions.get(sessionId);
    if (!intervention) throw new Error("No active intervention request");
    await this.operatorAction(intervention);
  }

  async resume(sessionId: string): Promise<void> {
    if (this.owner(sessionId) !== "human") throw new Error("Only the human owner can signal resume");
    this.states.set(sessionId, "automation");
    this.interventions.delete(sessionId);
  }

  async abort(sessionId: string): Promise<void> {
    this.states.set(sessionId, "paused");
    this.interventions.delete(sessionId);
  }
}
