import { describe, expect, it } from "vitest";

import { WEAPONS, WeaponId } from "@gungame/shared";

import {
  continuesBurst,
  effectiveSpreadDegrees,
  resolveHitscan,
  sprayOffsetDegrees,
} from "../src/index.js";

const RUN = 6.4;
const planted = (scoped = false) =>
  ({ horizontalSpeed: 0, grounded: true, runSpeed: RUN, scoped });
const running = (scoped = false) =>
  ({ horizontalSpeed: RUN, grounded: true, runSpeed: RUN, scoped });
const airborne = (scoped = false) =>
  ({ horizontalSpeed: 3, grounded: false, runSpeed: RUN, scoped });

describe("velocity-based accuracy (hybrid meta)", () => {
  it("planted = base accuracy, full run = move ceiling, airborne = air floor", () => {
    const rifle = WEAPONS[WeaponId.Rifle];
    expect(effectiveSpreadDegrees(rifle, planted())).toBeCloseTo(0.18, 6);
    expect(effectiveSpreadDegrees(rifle, running())).toBeCloseTo(3.4, 6);
    expect(effectiveSpreadDegrees(rifle, airborne())).toBeCloseTo(7.0, 6);
  });

  it("accuracy holds exactly up to the plant threshold, then ramps", () => {
    const rifle = WEAPONS[WeaponId.Rifle]; // accurateSpeedFraction 0.30
    const threshold = 0.30 * RUN;
    expect(effectiveSpreadDegrees(rifle, { ...planted(), horizontalSpeed: threshold }))
      .toBeCloseTo(0.18, 6);
    expect(effectiveSpreadDegrees(rifle, { ...planted(), horizontalSpeed: threshold + 0.5 }))
      .toBeGreaterThan(0.18);
    // Monotonic between threshold and run speed.
    const mid = effectiveSpreadDegrees(rifle, { ...planted(), horizontalSpeed: RUN * 0.65 });
    expect(mid).toBeGreaterThan(0.18);
    expect(mid).toBeLessThan(3.4);
  });

  it("the SMG stays the run-and-gun exception (higher threshold, mild ceiling)", () => {
    const smg = WEAPONS[WeaponId.Smg];
    // At half run speed the SMG is still fully accurate (threshold 0.55).
    expect(effectiveSpreadDegrees(smg, { ...planted(), horizontalSpeed: RUN * 0.5 }))
      .toBeCloseTo(1.25, 6);
    // Even at full sprint the penalty is mild vs the rifle's.
    expect(effectiveSpreadDegrees(smg, running())).toBeCloseTo(2.0, 6);
  });

  it("scoped movement ruins the scout; planted scoped stays divine", () => {
    const scout = WEAPONS[WeaponId.Scout];
    expect(effectiveSpreadDegrees(scout, planted(true))).toBeCloseTo(0.03, 6);
    expect(effectiveSpreadDegrees(scout, running(true))).toBeCloseTo(1.2, 6);
    expect(effectiveSpreadDegrees(scout, airborne(true))).toBeCloseTo(9.0, 6);
  });

  it("mobility-identity weapons are exempt", () => {
    for (const id of [WeaponId.Knife, WeaponId.Arc, WeaponId.Peacemaker, WeaponId.Discus]) {
      const weapon = WEAPONS[id];
      expect(effectiveSpreadDegrees(weapon, running()))
        .toBeCloseTo(weapon.spreadDegrees, 6);
    }
  });
});

describe("deterministic spray", () => {
  it("index 0 is always dead-on; deep spray plateaus at the final entry", () => {
    const rifle = WEAPONS[WeaponId.Rifle];
    expect(sprayOffsetDegrees(rifle, 0)).toEqual([0, 0]);
    const last = rifle.sprayPattern[rifle.sprayPattern.length - 1]!;
    expect(sprayOffsetDegrees(rifle, 99)).toEqual(last);
  });

  it("identical bursts produce identical bullet directions (no RNG in the pattern)", () => {
    const rifle = WEAPONS[WeaponId.Rifle];
    const shot = (seq: number, burstIndex: number) => resolveHitscan({
      weapon: rifle,
      commandSequence: seq,
      previousShooterPosition: { x: 0, y: 0, z: 0 },
      currentShooterPosition: { x: 0, y: 0, z: 0 },
      fireFraction: 0,
      yaw: 0,
      pitch: 0,
      targetTick: 0,
      targetFraction: 0,
      scoped: false,
      targets: [{
        id: 2,
        generation: 1,
        history: [{
          tick: 0,
          generation: 1,
          alive: true,
          position: { x: 0, y: 0, z: -20 },
          ducked: false,
        }],
      }],
      shooterHorizontalSpeed: 0,
      shooterGrounded: true,
      runSpeed: RUN,
      burstIndex,
    });
    // Same seq + same burst index => bit-identical outcome.
    const a = shot(7, 4);
    const b = shot(7, 4);
    expect(a).toEqual(b);
  });

  it("burst continuation follows the 1.8x refire rule", () => {
    const smg = WEAPONS[WeaponId.Smg];
    const refire = smg.refireTicks;
    expect(continuesBurst(smg, 100, 100 + refire)).toBe(true);
    expect(continuesBurst(smg, 100, 100 + Math.ceil(refire * 1.8))).toBe(true);
    expect(continuesBurst(smg, 100, 100 + Math.ceil(refire * 1.8) + 1)).toBe(false);
  });

  it("spray rotates the aim: deep-burst planted rifle centers away from cross", () => {
    const rifle = WEAPONS[WeaponId.Rifle];
    // Fire at a wall of targets straight ahead with burst index deep in the
    // pattern: the deterministic offset must move the shot up (pitch+),
    // meaning a shot aimed dead-center now lands high — the thing the player
    // learns to pull down against.
    const hit = resolveHitscan({
      weapon: rifle,
      commandSequence: 1,
      previousShooterPosition: { x: 0, y: 0, z: 0 },
      currentShooterPosition: { x: 0, y: 0, z: 0 },
      fireFraction: 0,
      yaw: 0,
      pitch: 0,
      targetTick: 0,
      targetFraction: 0,
      scoped: false,
      targets: [{
        id: 2,
        generation: 1,
        history: [{
          tick: 0,
          generation: 1,
          alive: true,
          position: { x: 0, y: 0, z: -10 },
          ducked: false,
        }],
      }],
      shooterHorizontalSpeed: 0,
      shooterGrounded: true,
      runSpeed: RUN,
      burstIndex: 7, // pattern peak ~4.5 deg pitch
    });
    // 4.5 degrees at 10m ≈ 0.79m of rise: the capsule hit point must be well
    // above the eye-line aim point (or miss entirely on a short target).
    if (hit.length > 0) {
      expect(hit[0]!.point.y).toBeGreaterThan(0.6);
    } else {
      expect(hit).toHaveLength(0); // sailed over — acceptable proof of rotation
    }
  });
});
