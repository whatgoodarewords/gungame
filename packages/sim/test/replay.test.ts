import { TICK_DT } from "@gungame/shared";
import { describe, expect, it } from "vitest";

import { Buttons, createInitialState, step, type Cmd } from "../src/index.js";

function scriptedCmd(tick: number): Cmd {
  const directions = [
    Buttons.Forward,
    Buttons.Right,
    Buttons.Backward,
    Buttons.Left,
  ] as const;

  return {
    seq: tick + 1,
    tick,
    buttons: directions[Math.floor(tick / 125) % directions.length] ?? 0,
    viewYaw: ((tick * 17) % 360) - 180,
    viewPitch: ((tick * 7) % 178) - 89,
    fireFraction: tick % 256,
    lastSnapshotTick: Math.max(0, tick - 5),
    interpTargetTick: Math.max(0, tick - 8),
    interpTargetFraction: (tick * 13) % 256,
  };
}

function replay(): string {
  let state = createInitialState();

  for (let tick = 0; tick < 1_000; tick += 1) {
    state = step(state, scriptedCmd(tick), TICK_DT);
  }

  return JSON.stringify(state);
}

describe("simulation replay determinism", () => {
  it("produces bit-exact state over 1,000 scripted ticks", () => {
    expect(replay()).toBe(replay());
  });
});
