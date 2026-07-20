import { DEFAULT_FEEL, TICK_DT } from "@gungame/shared";
import { describe, expect, it } from "vitest";

import {
  Buttons,
  CollisionWorld,
  createInitialState,
  DEFAULT,
  SCOUTZ,
  step,
  type MoveParams,
  type State,
} from "../src/index.js";
import { cmd, withPlayer, worldFromBoxes } from "./helpers.js";

const floor = worldFromBoxes([
  { min: [-20, -0.2, -20], max: [20, 0, 20] },
]);

const BALLISTIC: MoveParams = {
  ...DEFAULT,
  gravity: 0,
  airAccelerate: 0,
  groundAccelerate: 0,
  friction: 0,
};

function rampWorld(length: number, height: number): CollisionWorld {
  const minX = 0;
  const maxX = length;
  const minZ = -3;
  const maxZ = 3;
  return new CollisionWorld({
    positions: Float32Array.from([
      minX, 0, minZ, minX, 0, maxZ,
      maxX, 0, minZ, maxX, 0, maxZ,
      maxX, height, minZ, maxX, height, maxZ,
    ]),
    indices: Uint32Array.from([
      0, 2, 3, 0, 3, 1,
      0, 4, 2, 0, 5, 4, 0, 1, 5,
      2, 4, 5, 2, 5, 3,
      0, 4, 2, 1, 3, 5,
    ]),
  });
}

function speed(state: State): number {
  return Math.hypot(state.player.velocity.x, state.player.velocity.z);
}

describe("Phase 1c movement ordering", () => {
  it("has a zero-friction frame when jumping from ground", () => {
    const running = withPlayer(createInitialState(), {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 12, y: 0, z: 0 },
      grounded: true,
    });
    const jumped = step(running, cmd(0, Buttons.Jump), TICK_DT, {
      world: floor,
      params: DEFAULT,
    });
    expect(speed(jumped)).toBe(12);
    expect(jumped.player.grounded).toBe(false);
  });

  it("loses zero horizontal speed across two frame-perfect chained hops", () => {
    let state = withPlayer(createInitialState(), {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 12, y: 0, z: 0 },
      grounded: true,
    });
    state = step(state, cmd(0, Buttons.Jump), TICK_DT, {
      world: floor,
      params: DEFAULT,
    });
    let tick = 1;
    while (!state.player.grounded && tick < 200) {
      state = step(state, cmd(tick), TICK_DT, { world: floor, params: DEFAULT });
      tick += 1;
    }
    expect(state.player.grounded).toBe(true);
    state = step(state, cmd(tick, Buttons.Jump), TICK_DT, {
      world: floor,
      params: DEFAULT,
    });
    expect(state.player.grounded).toBe(false);
    expect(speed(state)).toBeCloseTo(12, 10);
  });

  it("surfs a >45-degree ramp without grounding or friction", () => {
    const length = 4;
    const height = 4.1;
    const slope = height / length;
    const x = 3;
    const capsuleSlopeOffset = 0.4 * Math.sqrt(1 + slope * slope) - 0.4;
    const world = rampWorld(length, height);
    let state = withPlayer(createInitialState(), {
      position: { x, y: slope * x + capsuleSlopeOffset + 1e-4, z: 0 },
      velocity: { x: -2, y: -2 * slope, z: 0 },
    });
    const initialSpeed = speed(state);
    for (let tick = 0; tick < 20; tick += 1) {
      state = step(state, cmd(tick), TICK_DT, { world, params: SCOUTZ });
      expect(state.player.grounded).toBe(false);
    }
    expect(speed(state)).toBeGreaterThan(initialSpeed);
  });

  it("grounds exactly at 45 degrees but not once normal.y falls below 0.7", () => {
    const contactPosition = (slope: number): { x: number; y: number; z: number } => ({
      x: 2,
      y: slope * 2 + 0.4 * Math.sqrt(1 + slope * slope) - 0.4 + 1e-4,
      z: 0,
    });
    const fortyFive = rampWorld(4, 4);
    const tooSteep = rampWorld(4, 4.1);
    expect(fortyFive.ground(contactPosition(1))).toBeDefined();
    expect(tooSteep.ground(contactPosition(4.1 / 4))).toBeUndefined();
  });

  it("treats upward velocity above 4.6 m/s as airborne even over a floor", () => {
    const rising = withPlayer(createInitialState(), {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 4.61, z: 0 },
      grounded: true,
    });
    const result = step(rising, cmd(0), TICK_DT, { world: floor, params: BALLISTIC });
    expect(result.player.grounded).toBe(false);
    expect(result.player.position.y).toBeGreaterThan(0);
  });

  it("allows a coyote jump two ticks after leaving a ledge and consumes it", () => {
    const ledge = worldFromBoxes([
      { min: [-5, -0.2, -2], max: [0, 0, 2] },
    ]);
    let state = withPlayer(createInitialState(), {
      position: { x: 0.39, y: 0, z: 0 },
      velocity: { x: 3, y: 0, z: 0 },
      grounded: true,
    });
    const coyoteParams = { ...BALLISTIC, gravity: 1 };
    state = step(state, cmd(0), TICK_DT, { world: ledge, params: coyoteParams });
    expect(state.player.grounded).toBe(false);
    expect(state.player.coyoteTicksLeft).toBeGreaterThan(0);
    state = step(state, cmd(1), TICK_DT, { world: ledge, params: coyoteParams });
    state = step(state, cmd(2, Buttons.Jump), TICK_DT, {
      world: ledge,
      params: coyoteParams,
    });
    expect(state.player.velocity.y).toBeCloseTo(DEFAULT.jumpVelocity - TICK_DT, 10);
    expect(state.player.coyoteTicksLeft).toBe(0);
    const held = step(state, cmd(3, Buttons.Jump), TICK_DT, {
      world: ledge,
      params: coyoteParams,
    });
    expect(held.player.velocity.y).toBeCloseTo(DEFAULT.jumpVelocity - TICK_DT * 2, 10);
    expect(held.player.coyoteTicksLeft).toBe(0);
  });
});

describe("airborne corner correction", () => {
  function clipCorner(overlap: number, grounded = false): State {
    const tower = worldFromBoxes([
      { min: [1, -1, 0], max: [2, 4, 1] },
      ...(grounded
        ? [{ min: [-5, -0.2, -5], max: [5, 0, 5] } as const]
        : []),
    ]);
    let state = withPlayer(createInitialState(), {
      position: { x: 0.9, y: grounded ? 0 : 1, z: -0.4 + overlap },
      velocity: { x: 10, y: 0, z: 0 },
      grounded,
    });
    return step(state, cmd(0), TICK_DT, {
      world: tower,
      params: BALLISTIC,
    });
  }

  it("nudges a 3 cm tower-corner clip but blocks a 10 cm clip", () => {
    const unobstructedEnd = 0.9 + 10 * TICK_DT;
    expect(clipCorner(0.03).player.position.x).toBeCloseTo(unobstructedEnd, 8);
    expect(clipCorner(0.1).player.position.x).toBeLessThan(unobstructedEnd - 0.01);
  });

  it("never applies the nudge while grounded", () => {
    const unobstructedEnd = 0.9 + 10 * TICK_DT;
    expect(clipCorner(0.03, true).player.position.x)
      .toBeLessThan(unobstructedEnd - 0.005);
  });

  it("rejects a clearing nudge that would cross a kill volume", () => {
    const tower = worldFromBoxes(
      [{ min: [1, -1, 0], max: [2, 4, 1] }],
      [{
        min: { x: 0.5, y: 1, z: -0.82 },
        max: { x: 1.4, y: 1.1, z: -0.78 },
      }],
    );
    const state = withPlayer(createInitialState(), {
      position: { x: 0.9, y: 1, z: -0.37 },
      velocity: { x: 10, y: 0, z: 0 },
    });
    const result = step(state, cmd(0), TICK_DT, {
      world: tower,
      params: BALLISTIC,
    });
    expect(result.player.position.x).toBeLessThan(0.9 + 10 * TICK_DT - 0.005);
  });
});

describe("duck landing slide", () => {
  function land(ducked: boolean): State {
    let state = withPlayer(createInitialState(), {
      position: { x: 0, y: ducked ? -0.4 : 0.05, z: 0 },
      velocity: { x: 12, y: -2, z: 0 },
      ducked,
      duckProgress: ducked ? 1 : 0,
    });
    state = step(
      state,
      cmd(0, ducked ? Buttons.Duck : 0),
      TICK_DT,
      { world: floor, params: DEFAULT },
    );
    return state;
  }

  it("starts only when landing ducked above run speed", () => {
    const ducked = land(true);
    const standing = land(false);
    expect(ducked.player.slideTicksLeft).toBe(
      Math.ceil(DEFAULT_FEEL.slideMs / (TICK_DT * 1_000)),
    );
    expect(standing.player.slideTicksLeft).toBe(0);
  });

  it("retains at least 85% early in the slide window while baseline loses more", () => {
    let sliding = land(true);
    let standing = land(false);
    for (let tick = 1; tick <= 6; tick += 1) {
      sliding = step(sliding, cmd(tick, Buttons.Duck), TICK_DT, {
        world: floor,
        params: DEFAULT,
      });
      standing = step(standing, cmd(tick), TICK_DT, {
        world: floor,
        params: DEFAULT,
      });
    }
    expect(speed(sliding)).toBeGreaterThanOrEqual(12 * 0.85);
    expect(speed(standing)).toBeLessThan(speed(sliding));
    expect(sliding.player.slideTicksLeft).toBeGreaterThan(0);
  });

  it("ignores acceleration above run speed until the 300 ms timer expires", () => {
    let state = land(true);
    const slideTicks = state.player.slideTicksLeft;
    for (let tick = 1; tick <= slideTicks; tick += 1) {
      state = step(
        state,
        cmd(tick, Buttons.Duck | Buttons.Forward),
        TICK_DT,
        { world: floor, params: DEFAULT },
      );
    }
    expect(state.player.slideTicksLeft).toBe(0);
    expect(state.player.velocity.z).toBeCloseTo(0, 12);
    expect(speed(state)).toBeCloseTo(
      12 * (1 - DEFAULT.friction * DEFAULT_FEEL.slideFrictionScale * TICK_DT) ** slideTicks,
      8,
    );
  });
});

describe("pm_stopspeed crisp stops (J2)", () => {
  it("reaches a full stop from run speed within 0.45s of releasing input", () => {
    let state = withPlayer(createInitialState(), {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: DEFAULT.runSpeed, y: 0, z: 0 },
      grounded: true,
    });
    let stopTick = -1;
    for (let tick = 1; tick <= 64; tick += 1) {
      state = step(state, cmd(tick), TICK_DT, { world: floor, params: DEFAULT, feel: DEFAULT_FEEL });
      if (Math.hypot(state.player.velocity.x, state.player.velocity.z) === 0) {
        stopTick = tick;
        break;
      }
    }
    // Pure proportional friction never reaches zero (asymptotic drift — the
    // "mushy stop"); Q3's stopspeed clamp makes low-speed decel linear.
    expect(stopTick).toBeGreaterThan(0);
    expect(stopTick * TICK_DT).toBeLessThan(0.45);
  });

  it("does not change deceleration above stopSpeed (top-speed friction identical)", () => {
    const before = withPlayer(createInitialState(), {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: DEFAULT.runSpeed, y: 0, z: 0 },
      grounded: true,
    });
    const after = step(before, cmd(1), TICK_DT, { world: floor, params: DEFAULT, feel: DEFAULT_FEEL });
    const speed = Math.hypot(after.player.velocity.x, after.player.velocity.z);
    // At 6.4 m/s the control value is the speed itself: one tick of classic
    // proportional decay, unchanged by the clamp.
    expect(speed).toBeCloseTo(DEFAULT.runSpeed * (1 - DEFAULT.friction * TICK_DT), 5);
  });
});
