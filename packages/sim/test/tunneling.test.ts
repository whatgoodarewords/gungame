import { TICK_DT } from "@gungame/shared";
import { describe, expect, it } from "vitest";

import { createInitialState, step, type MoveParams } from "../src/index.js";
import { cmd, withPlayer, worldFromBoxes } from "./helpers.js";

const BALLISTIC: MoveParams = {
  gravity: 0,
  runSpeed: 0,
  airAccelerate: 0,
  groundAccelerate: 0,
  friction: 0,
  jumpVelocity: 0,
};

const world = worldFromBoxes([
  { min: [1, -1, -20], max: [1.1, 4, 20] },
]);

function fire(velocity: { x: number; y: number; z: number }) {
  let state = withPlayer(createInitialState(), {
    position: { x: 0, y: 0, z: 0 },
    velocity,
  });
  for (let tick = 0; tick < 10; tick += 1) {
    state = step(state, cmd(tick), TICK_DT, { world, params: BALLISTIC });
  }
  return state;
}

describe("swept capsule tunneling", () => {
  it("does not pass through a 0.1 m wall at 30 m/s", () => {
    const state = fire({ x: 30, y: 0, z: 0 });
    expect(state.player.position.x).toBeLessThanOrEqual(0.6001);
  });

  it("does not pass the wall on a 30 m/s diagonal approach", () => {
    const component = 30 / Math.sqrt(2);
    const state = fire({ x: component, y: 0, z: component });
    expect(state.player.position.x).toBeLessThanOrEqual(0.6001);
    expect(state.player.position.z).toBeGreaterThan(1);
  });
});
