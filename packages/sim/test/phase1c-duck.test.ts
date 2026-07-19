import { DEFAULT_FEEL, TICK_DT } from "@gungame/shared";
import { describe, expect, it } from "vitest";

import {
  Buttons,
  createInitialState,
  DEFAULT,
  step,
  type MoveParams,
} from "../src/index.js";
import { cmd, withPlayer, worldFromBoxes } from "./helpers.js";

const NO_GRAVITY: MoveParams = {
  ...DEFAULT,
  gravity: 0,
  friction: 0,
};

const floor = worldFromBoxes([
  { min: [-20, -0.2, -20], max: [20, 0, 20] },
]);

describe("GoldSrc-faithful duck", () => {
  it("ships the Phase 1c feel defaults as named metric dials", () => {
    expect(DEFAULT_FEEL).toMatchObject({
      duckTransitionMs: 400,
      duckSpeedScale: 0.333,
      feetTuck: 0.45,
      coyoteMs: 50,
      cornerNudge: 0.05,
      slideFrictionScale: 0.25,
      slideMs: 300,
      jumpBufferMs: 80,
    });
  });

  it("keeps the standing hull and speed for the full grounded transition", () => {
    let ducking = createInitialState();
    let standing = createInitialState();
    for (let tick = 0; tick < 25; tick += 1) {
      ducking = step(
        ducking,
        cmd(tick, Buttons.Forward | Buttons.Duck),
        TICK_DT,
        { world: floor, params: NO_GRAVITY },
      );
      standing = step(
        standing,
        cmd(tick, Buttons.Forward),
        TICK_DT,
        { world: floor, params: NO_GRAVITY },
      );
    }

    expect(ducking.player.ducked).toBe(false);
    expect(ducking.player.duckProgress).toBeCloseTo(25 * TICK_DT * 1_000 / 400);
    expect(ducking.player.position.y).toBeCloseTo(standing.player.position.y, 8);
    expect(ducking.player.velocity).toEqual(standing.player.velocity);

    ducking = step(
      ducking,
      cmd(25, Buttons.Forward | Buttons.Duck),
      TICK_DT,
      { world: floor, params: NO_GRAVITY },
    );
    expect(ducking.player.ducked).toBe(true);
    expect(ducking.player.duckProgress).toBe(1);
    expect(ducking.player.position.y).toBeCloseTo(-DEFAULT_FEEL.feetTuck, 6);

    const restarted = withPlayer(ducking, {
      velocity: { x: 0, y: 0, z: 0 },
    });
    const scaled = step(
      restarted,
      cmd(26, Buttons.Forward | Buttons.Duck),
      TICK_DT,
      { world: floor, params: { ...NO_GRAVITY, groundAccelerate: 100 } },
    );
    expect(Math.hypot(scaled.player.velocity.x, scaled.player.velocity.z))
      .toBeCloseTo(DEFAULT.runSpeed * DEFAULT_FEEL.duckSpeedScale, 6);
  });

  it("tucks airborne feet upward so a low obstacle clears", () => {
    const world = worldFromBoxes([
      { min: [1, 0, -2], max: [2, 0.9, 2] },
    ]);
    const start = withPlayer(createInitialState(), {
      position: { x: 0, y: 0.5, z: 0 },
      velocity: { x: 10, y: 0, z: 0 },
    });
    let standing = start;
    let ducking = start;
    for (let tick = 0; tick < 10; tick += 1) {
      standing = step(standing, cmd(tick), TICK_DT, {
        world,
        params: NO_GRAVITY,
        feel: { ...DEFAULT_FEEL, cornerNudge: 0 },
      });
      ducking = step(ducking, cmd(tick, Buttons.Duck), TICK_DT, {
        world,
        params: NO_GRAVITY,
        feel: { ...DEFAULT_FEEL, cornerNudge: 0 },
      });
    }

    expect(standing.player.position.x).toBeLessThan(0.61);
    expect(ducking.player.ducked).toBe(true);
    expect(ducking.player.position.y).toBeCloseTo(0.5, 8);
    expect(ducking.player.position.x).toBeGreaterThan(1.4);
  });

  it("refuses a grounded unduck until the standing hull fits", () => {
    const tunnel = worldFromBoxes([
      { min: [-4, -0.2, -4], max: [4, 0, 4] },
      { min: [-4, 1.2, -4], max: [4, 1.4, 4] },
    ]);
    const ducked = withPlayer(createInitialState(), {
      position: { x: 0, y: -DEFAULT_FEEL.feetTuck, z: 0 },
      grounded: true,
      ducked: true,
      duckProgress: 1,
    });
    const blocked = step(ducked, cmd(0), TICK_DT, {
      world: tunnel,
      params: NO_GRAVITY,
    });
    expect(blocked.player.ducked).toBe(true);
    expect(blocked.player.position.y).toBeCloseTo(-DEFAULT_FEEL.feetTuck, 8);
  });

  it("stays ducked when an airborne unduck would embed in a vent", () => {
    const vent = worldFromBoxes([
      { min: [-3, 1.15, -3], max: [3, 1.35, 3] },
    ]);
    const airborne = withPlayer(createInitialState(), {
      position: { x: 0, y: 0.2, z: 0 },
      velocity: { x: 1, y: 0, z: 0 },
      grounded: false,
      ducked: true,
      duckProgress: 1,
    });
    const blocked = step(airborne, cmd(0), TICK_DT, {
      world: vent,
      params: NO_GRAVITY,
    });
    expect(blocked.player.ducked).toBe(true);
    expect(blocked.player.position.y).toBeCloseTo(0.2, 8);
  });

  it("performs jumpbug on airborne duck release plus jump without friction", () => {
    const falling = withPlayer(createInitialState(), {
      position: { x: 0, y: 0.03, z: 0 },
      velocity: { x: 12, y: -1, z: 0 },
      ducked: true,
      duckProgress: 1,
    });
    const jumped = step(falling, cmd(0, Buttons.Jump), TICK_DT, {
      world: floor,
      params: DEFAULT,
    });

    expect(jumped.player.ducked).toBe(false);
    expect(jumped.player.grounded).toBe(false);
    expect(jumped.player.velocity.y).toBeGreaterThan(4.9);
    expect(Math.hypot(jumped.player.velocity.x, jumped.player.velocity.z)).toBe(12);
  });
});
