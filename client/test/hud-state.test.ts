import { describe, expect, it } from "vitest";

import { HudStateMachine } from "../src/hud-state.js";

describe("HUD state machine", () => {
  it("moves through name, play, death, respawn, win, and next-round play", () => {
    const hud = new HudStateMachine(false);
    expect(hud.state).toBe("name-entry");
    expect(hud.dispatch({ type: "submit-name" })).toBe("connecting");
    expect(hud.dispatch({ type: "connected" })).toBe("playing");
    expect(hud.dispatch({ type: "snapshot", alive: false, frozen: false })).toBe("dead");
    expect(hud.dispatch({ type: "snapshot", alive: true, frozen: false })).toBe("playing");
    expect(hud.dispatch({ type: "snapshot", alive: true, frozen: true })).toBe("win");
    expect(hud.dispatch({ type: "snapshot", alive: true, frozen: false })).toBe("playing");
  });

  it("keeps server restart and lost-connection states terminal against stale snapshots", () => {
    const restart = new HudStateMachine(true);
    restart.dispatch({ type: "connected" });
    expect(restart.dispatch({ type: "server-restarting" })).toBe("server-restarting");
    expect(restart.dispatch({ type: "snapshot", alive: true, frozen: false })).toBe("server-restarting");

    const lost = new HudStateMachine(true);
    expect(lost.dispatch({ type: "connection-lost" })).toBe("connection-lost");
    expect(lost.dispatch({ type: "snapshot", alive: true, frozen: false })).toBe("connection-lost");
  });

  it("exposes version mismatch as a force-reload state", () => {
    const hud = new HudStateMachine(true);
    expect(hud.dispatch({ type: "version-mismatch" })).toBe("version-mismatch");
  });
});
