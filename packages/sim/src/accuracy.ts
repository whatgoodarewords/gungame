// Velocity-based accuracy + deterministic spray (hybrid-meta-spec).
// Shared by the server's hit resolution and the client's crosshair bloom +
// camera kick, so what the player sees IS what the server rolls.

import type { WeaponDefinition } from "@gungame/shared";

export interface AccuracyState {
  readonly horizontalSpeed: number;
  readonly grounded: boolean;
  readonly runSpeed: number;
  readonly scoped: boolean;
}

/**
 * Effective cone spread in degrees for the current movement state.
 * Planted below accurateSpeedFraction*runSpeed = base accuracy; lerps to
 * moveSpreadDegrees at full run speed; airborne floors at airSpreadDegrees.
 * Weapons with moveSpreadDegrees 0 are exempt (mobility-identity weapons).
 */
export function effectiveSpreadDegrees(
  weapon: WeaponDefinition,
  state: AccuracyState,
): number {
  const base = state.scoped ? weapon.scopedSpreadDegrees : weapon.spreadDegrees;
  if (weapon.moveSpreadDegrees <= 0) return base;
  const moveCeiling = state.scoped && weapon.scopedMoveSpreadDegrees > 0
    ? weapon.scopedMoveSpreadDegrees
    : weapon.moveSpreadDegrees;
  const threshold = weapon.accurateSpeedFraction * state.runSpeed;
  const span = Math.max(0.001, state.runSpeed - threshold);
  const fraction = Math.min(1, Math.max(0, (state.horizontalSpeed - threshold) / span));
  let spread = base + (moveCeiling - base) * fraction;
  if (!state.grounded) spread = Math.max(spread, weapon.airSpreadDegrees);
  return spread;
}

/**
 * Deterministic spray offset (yawDeg, pitchDeg) for a burst index. Index 0 is
 * always (0,0); indices beyond the table hold the final entry (deep spray
 * plateaus rather than resetting). Pure data lookup — the same table drives
 * the server bullet path and the client camera kick.
 */
export function sprayOffsetDegrees(
  weapon: WeaponDefinition,
  burstIndex: number,
): readonly [number, number] {
  const pattern = weapon.sprayPattern;
  if (pattern.length === 0 || burstIndex <= 0) return ZERO_OFFSET;
  return pattern[Math.min(burstIndex, pattern.length - 1)] ?? ZERO_OFFSET;
}

const ZERO_OFFSET: readonly [number, number] = [0, 0];

/**
 * Burst continuation rule: a shot at `tick` continues the burst if it lands
 * within 1.8x the weapon's refire window of the previous shot.
 */
export function continuesBurst(
  weapon: WeaponDefinition,
  lastShotTick: number,
  tick: number,
): boolean {
  return tick - lastShotTick <= Math.ceil(weapon.refireTicks * 1.8);
}
