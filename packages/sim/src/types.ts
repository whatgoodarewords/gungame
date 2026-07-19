import type { PlayerId, Vec3 } from "@gungame/shared";

export const Buttons = {
  Forward: 1 << 0,
  Backward: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Jump: 1 << 4,
  Fire: 1 << 5,
  Duck: 1 << 6,
  Zoom: 1 << 7,
  Background: 1 << 8,
  Melee: 1 << 9,
} as const;

export interface Cmd {
  readonly seq: number;
  /** Advisory client tick; the server execution tick remains authoritative. */
  readonly tick: number;
  readonly buttons: number;
  readonly viewYaw: number;
  readonly viewPitch: number;
  /** Unsigned 8-bit fraction of the server execution tick when firing. */
  readonly fireFraction: number;
  readonly lastSnapshotTick: number;
  readonly interpTargetTick: number;
  /** Unsigned 8-bit fractional part of interpTargetTick. */
  readonly interpTargetFraction: number;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly viewYaw: number;
  readonly viewPitch: number;
  readonly grounded: boolean;
  readonly jumpBufferTicks: number;
  readonly jumpButtonDown: boolean;
  readonly ducked: boolean;
  readonly duckProgress: number;
  readonly coyoteTicksLeft: number;
  readonly slideTicksLeft: number;
}

export interface State {
  readonly tick: number;
  readonly player: PlayerState;
}
