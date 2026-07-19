import { TICK_DT } from "@gungame/shared";
import { describe, expect, it } from "vitest";

import { CollisionWorld, createInitialState, step, type MoveParams } from "../src/index.js";
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

  it("registers a grazing sweep that converges at the iteration limit", () => {
    const grazingWorld = new CollisionWorld({
      positions: Float32Array.from([
        -0.0559183117, -3.5392390341, 2.0353806149,
        -0.1934040897, 3.9462033827, -3.9258911684,
        1.8914368954, 1.8867855333, 3.5783253107,
      ]),
      indices: Uint32Array.from([0, 1, 2]),
    });
    const hit = grazingWorld.sweepCapsule(
      { x: -0.804730535, y: 0.3783331299, z: -0.5747838574 },
      { x: 11.1546110921, y: 3.8653484802, z: 9.2378699128 },
    );
    expect(hit).toBeDefined();
    expect(hit?.time).toBeCloseTo(0.0754237422, 8);
  });
});
