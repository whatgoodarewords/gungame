import { TICK_DT } from "@gungame/shared";
import { describe, expect, it } from "vitest";

import {
  Buttons,
  createInitialState,
  DEFAULT,
  SCOUTZ,
  step,
  type MoveParams,
} from "../src/index.js";
import { cmd, withPlayer } from "./helpers.js";

function circleStrafe(params: MoveParams): number {
  let state = withPlayer(createInitialState(), {
    position: { x: 0, y: 20, z: 0 },
    velocity: { x: 0, y: 0, z: -params.runSpeed },
  });
  const noGravity = { ...params, gravity: 0 };
  for (let tick = 0; tick < 256; tick += 1) {
    state = step(state, cmd(tick, Buttons.Forward, tick * 1.5), TICK_DT, {
      params: noGravity,
    });
  }
  return Math.hypot(state.player.velocity.x, state.player.velocity.z);
}

describe("air acceleration", () => {
  it("lets SCOUTZ circle strafing exceed run speed while DEFAULT stays near it", () => {
    const scoutzSpeed = circleStrafe(SCOUTZ);
    const defaultSpeed = circleStrafe(DEFAULT);
    expect(scoutzSpeed).toBeGreaterThan(SCOUTZ.runSpeed * 1.2);
    expect(defaultSpeed).toBeLessThan(DEFAULT.runSpeed * 1.12);
  });
});
