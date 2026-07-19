export type HudState =
  | "name-entry"
  | "connecting"
  | "playing"
  | "dead"
  | "win"
  | "server-restarting"
  | "connection-lost"
  | "version-mismatch";

export type HudEvent =
  | { readonly type: "submit-name" }
  | { readonly type: "connected" }
  | { readonly type: "snapshot"; readonly alive: boolean; readonly frozen: boolean }
  | { readonly type: "server-restarting" }
  | { readonly type: "connection-lost" }
  | { readonly type: "version-mismatch" };

export class HudStateMachine {
  private current: HudState;

  constructor(hasName: boolean) {
    this.current = hasName ? "connecting" : "name-entry";
  }

  get state(): HudState {
    return this.current;
  }

  dispatch(event: HudEvent): HudState {
    if (event.type === "version-mismatch") this.current = "version-mismatch";
    else if (event.type === "server-restarting") this.current = "server-restarting";
    else if (event.type === "connection-lost") this.current = "connection-lost";
    else if (event.type === "submit-name" && this.current === "name-entry") this.current = "connecting";
    else if (event.type === "connected" && this.current === "connecting") this.current = "playing";
    else if (event.type === "snapshot" && !this.isConnectionTerminal()) {
      this.current = event.frozen ? "win" : event.alive ? "playing" : "dead";
    }
    return this.current;
  }

  private isConnectionTerminal(): boolean {
    return this.current === "server-restarting" ||
      this.current === "connection-lost" || this.current === "version-mismatch";
  }
}
