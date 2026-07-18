import { TICK_DT, vec3, vec3AddScaled } from "@gungame/shared";

import { Buttons, type Cmd, type State } from "./types.js";

const SKELETON_MOVE_SPEED = 1;

function isPressed(buttons: number, button: number): number {
  return (buttons & button) === 0 ? 0 : 1;
}

/**
 * Advances one fixed simulation tick without mutating its inputs.
 * Phase 1 replaces the deliberately small planar integrator with pmove.
 */
export function step(state: State, cmd: Cmd, dt: number): State {
  if (dt !== TICK_DT) {
    throw new RangeError(`simulation dt must be exactly 1/64 (${TICK_DT})`);
  }

  const inputX =
    isPressed(cmd.buttons, Buttons.Right) - isPressed(cmd.buttons, Buttons.Left);
  const inputZ =
    isPressed(cmd.buttons, Buttons.Backward) -
    isPressed(cmd.buttons, Buttons.Forward);
  const inputLength = Math.hypot(inputX, inputZ);
  const scale = inputLength === 0 ? 0 : SKELETON_MOVE_SPEED / inputLength;
  const velocity = vec3(inputX * scale, 0, inputZ * scale);

  return {
    tick: state.tick + 1,
    player: {
      ...state.player,
      position: vec3AddScaled(state.player.position, velocity, dt),
      velocity,
      viewYaw: cmd.viewYaw,
      viewPitch: cmd.viewPitch,
    },
  };
}
