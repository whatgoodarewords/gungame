import { describe, expect, it } from "vitest";

import {
  PLAYER_NAME_STORAGE_KEY,
  defaultCreateRoomState,
  filterPlayerName,
  frontDoorCardWidth,
  persistPlayerName,
  persistedPlayerName,
  updateCreateRoomState,
  validPlayerName,
  visibleCreateRows,
} from "../src/menu.js";

describe("front-door player names", () => {
  it("filters live input to the exact 16-character ASCII allowlist", () => {
    expect(filterPlayerName("a!b@ C_—-🙂12345678901234567890"))
      .toBe("ab C_-1234567890");
    expect(validPlayerName("A_ player-7")).toBe(true);
    expect(validPlayerName("x")).toBe(false);
    expect(validPlayerName("bad!name")).toBe(false);
  });

  it("persists filtered names and prefills them on return", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(persistPlayerName(storage, "Duna!Runner")).toBe("DunaRunner");
    expect(values.get(PLAYER_NAME_STORAGE_KEY)).toBe("DunaRunner");
    expect(persistedPlayerName(storage)).toBe("DunaRunner");
  });
});

describe("create-room disclosure and segmented state", () => {
  it("starts collapsed and exposes the conditional ladder row only for Gun Game", () => {
    let state = defaultCreateRoomState();
    expect(visibleCreateRows(state)).toEqual([]);
    state = updateCreateRoomState(state, { type: "toggle" });
    expect(visibleCreateRows(state)).toEqual(["mode", "ladder", "gravity", "map"]);
    state = updateCreateRoomState(state, { type: "mode", value: "scoutz" });
    expect(visibleCreateRows(state)).toEqual(["mode", "gravity", "map"]);
  });

  it("auto-pairs ARSENAL with Scoutz gravity but leaves gravity changeable", () => {
    let state = updateCreateRoomState(defaultCreateRoomState(), {
      type: "ladder",
      value: "arsenal",
    });
    expect(state.ladder).toBe("arsenal");
    expect(state.gravity).toBe("scoutz");
    state = updateCreateRoomState(state, { type: "gravity", value: "standard" });
    expect(state.gravity).toBe("standard");
  });

  it("maintains active segmented values and rejects mode-incompatible map pins", () => {
    let state = updateCreateRoomState(defaultCreateRoomState(), { type: "map", value: "duna" });
    expect(state.map).toBe("duna");
    state = updateCreateRoomState(state, { type: "mode", value: "scoutz" });
    expect(state.map).toBe("auto");
    const rejected = updateCreateRoomState(state, { type: "map", value: "cascade" });
    expect(rejected).toEqual(state);
    expect(updateCreateRoomState(state, { type: "map", value: "spire" }).map).toBe("spire");
  });
});

describe("front-door responsive bounds", () => {
  it.each([
    [360, 328],
    [768, 420],
    [1_440, 420],
  ])("keeps the fixed-max card inside a %ipx viewport", (viewport, expected) => {
    expect(frontDoorCardWidth(viewport)).toBe(expected);
    expect(frontDoorCardWidth(viewport)).toBeLessThanOrEqual(viewport);
  });
});
