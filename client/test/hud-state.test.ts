import { describe, expect, it } from "vitest";

import { HudStateMachine } from "../src/hud-state.js";
import { armInviteCopy, inviteUrl, reconnectStatusText } from "../src/hud.js";
import { surfaceWebSocketClose, webSocketCloseForensics } from "../src/net/session.js";
import { canonicalRoomUrl, quickplayUrl, roomIdFromUrl } from "../src/room-url.js";

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

  it("surfaces the WebSocket close code and reason for live forensics", () => {
    expect(webSocketCloseForensics(4002, "protocol state error")).toEqual({
      consoleMessage: "websocket closed · code 4002 · protocol state error",
      telemetry: "ws 4002 · protocol state error",
    });
    expect(webSocketCloseForensics(1006, "")).toEqual({
      consoleMessage: "websocket closed · code 1006 · no reason",
      telemetry: "ws 1006 · no reason",
    });
  });

  it("publishes close forensics through the stable data-last-close contract", () => {
    const target = { dataset: {} } as HTMLElement;
    expect(surfaceWebSocketClose(target, 4008, "Backpressure")).toBe("ws 4008 · backpressure");
    expect(target.dataset.lastClose).toBe("ws 4008 · backpressure");
  });

  it("replaces exhausted reconnect countdown copy with a rejoin action", () => {
    expect(reconnectStatusText(2)).toBe("reconnecting… 2");
    expect(reconnectStatusText()).toBe("connection lost — rejoin?");
  });

  it("builds the same repeatable canonical invite on every copy", () => {
    const first = inviteUrl("https://example.test/gg/?create=1&style=toon-cel", "room-7");
    const second = inviteUrl("https://example.test/gg/?create=1&style=toon-cel", "room-7");
    expect(first).toBe("https://example.test/gg/r/room-7?style=toon-cel");
    expect(second).toBe(first);
  });

  it("parses canonical cold room paths before the legacy query fallback", () => {
    expect(roomIdFromUrl("/gg/r/r000001", "")).toBe("r000001");
    expect(roomIdFromUrl("/gg/r/r000001", "?room=legacy")).toBe("r000001");
    expect(roomIdFromUrl("/gg/", "?room=legacy")).toBe("legacy");
  });

  it("replaces an existing room route and strips player/create parameters", () => {
    expect(canonicalRoomUrl(
      "https://example.test/gg/r/old?room=old&create=1&name=Ari&mode=scoutz&style=toon-cel",
      "new",
    )).toBe("https://example.test/gg/r/new?style=toon-cel");
  });

  it("turns a canonical room route back into a true quickplay URL", () => {
    expect(quickplayUrl(
      "https://example.test/gg/r/r000001?room=r000001&create=1&name=Ari&style=toon-cel",
    )).toBe("https://example.test/gg/?name=Ari&style=toon-cel");
  });

  it("keeps the invite handler armed for repeated clicks", () => {
    const writes: string[] = [];
    const control: {
      textContent: string | null;
      onclick: ((event: PointerEvent) => unknown) | null;
    } = { textContent: "copy invite link", onclick: null };
    armInviteCopy(
      control,
      "https://example.test/gg/?create=1",
      "room-7",
      (url) => { writes.push(url); },
    );
    control.onclick?.(undefined as unknown as PointerEvent);
    control.onclick?.(undefined as unknown as PointerEvent);
    expect(writes).toEqual([
      "https://example.test/gg/r/room-7",
      "https://example.test/gg/r/room-7",
    ]);
    expect(control.onclick).not.toBeNull();
  });
});
