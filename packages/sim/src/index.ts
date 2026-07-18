import { vec3 } from "@gungame/shared";

import type { State } from "./types.js";

export * from "./collision.js";
export * from "./params.js";
export { step } from "./step.js";
export type { StepOptions } from "./step.js";
export { Buttons } from "./types.js";
export type { Cmd, PlayerState, State } from "./types.js";

export function createInitialState(playerId = "player-0"): State {
  return {
    tick: 0,
    player: {
      id: playerId,
      position: vec3(),
      velocity: vec3(),
      viewYaw: 0,
      viewPitch: 0,
      grounded: false,
      jumpBufferTicks: 0,
      jumpButtonDown: false,
    },
  };
}
