import { TICK_DT } from "@gungame/shared";
import { describe, expect, it } from "vitest";

import { Buttons, createInitialState, SCOUTZ, step } from "../src/index.js";
import { cmd, worldFromBoxes } from "./helpers.js";

const world = worldFromBoxes([
  { min: [-20, -0.2, -20], max: [20, 0, 20] },
  { min: [-20, 0, -20], max: [-19.5, 5, 20] },
  { min: [19.5, 0, -20], max: [20, 5, 20] },
  { min: [-20, 0, -20], max: [20, 5, -19.5] },
  { min: [-20, 0, 19.5], max: [20, 5, 20] },
  { min: [2, 0, -4], max: [5, 0.4, 4] },
]);

function replay(): string {
  let state = createInitialState();
  for (let tick = 0; tick < 1_000; tick += 1) {
    const strafe = Math.floor(tick / 80) % 2 === 0 ? Buttons.Right : Buttons.Left;
    const jump = tick % 43 === 0 ? Buttons.Jump : 0;
    const duck =
      tick % 131 >= 82 && tick % 131 < 116
        ? Buttons.Duck
        : 0;
    const jumpbugRelease = tick % 257 === 196 ? Buttons.Jump : 0;
    state = step(
      state,
      cmd(tick, Buttons.Forward | strafe | jump | duck | jumpbugRelease, tick * 1.3),
      TICK_DT,
      { world, params: SCOUTZ },
    );
  }
  return JSON.stringify(state);
}

describe("simulation replay determinism", () => {
  it("is bit-exact over scripted strafe, duck, slide, and jumpbug inputs", () => {
    expect(replay()).toBe(replay());
  });
});
