import { TICK_DT } from "@gungame/shared";
import { describe, expect, it } from "vitest";

import { Buttons, createInitialState, DEFAULT, step } from "../src/index.js";
import { cmd, worldFromBoxes } from "./helpers.js";

function approach(height: number) {
  const world = worldFromBoxes([
    { min: [-20, -0.2, -5], max: [20, 0, 5] },
    { min: [1, 0, -2], max: [4, height, 2] },
  ]);
  let state = createInitialState();
  for (let tick = 0; tick < 35; tick += 1) {
    state = step(state, cmd(tick, Buttons.Right), TICK_DT, {
      world,
      params: DEFAULT,
    });
  }
  return state;
}

describe("step-up", () => {
  it("crosses a 0.4 m ledge", () => {
    const state = approach(0.4);
    expect(state.player.position.x).toBeGreaterThan(1.5);
    expect(state.player.position.y).toBeGreaterThanOrEqual(0.39);
    expect(state.player.position.y).toBeLessThan(0.43);
  });

  it("does not cross a 0.5 m ledge", () => {
    const state = approach(0.5);
    expect(state.player.position.x).toBeLessThan(1);
  });
});
