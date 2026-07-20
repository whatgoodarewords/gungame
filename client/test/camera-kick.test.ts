import { describe, expect, it } from "vitest";

import { WeaponId } from "@gungame/shared";

import { CameraKick } from "../src/camera-kick.js";

const DEG = Math.PI / 180;

function settle(kick: CameraKick, ms: number, stepMs = 8): void {
  for (let t = 0; t < ms; t += stepMs) kick.update(stepMs);
}

describe("camera recoil kick (J1)", () => {
  it("ramps in (no instant step), peaks early, and fully recovers", () => {
    const kick = new CameraKick();
    expect(kick.pitchOffset).toBe(0);
    kick.fire(WeaponId.Pistol, false);
    // Walk fine steps recording the trajectory: the punch must build over
    // multiple frames (no 0-frame step), crest within ~40 ms, then recover.
    let peak = 0;
    let peakAtMs = 0;
    let first = -1;
    for (let t = 4; t <= 240; t += 4) {
      kick.update(4);
      if (first < 0) first = kick.pitchOffset;
      if (kick.pitchOffset > peak) {
        peak = kick.pitchOffset;
        peakAtMs = t;
      }
    }
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(peak); // ramped, not stepped
    expect(peak).toBeGreaterThan(0.55 * DEG * 0.5); // a real punch survives the decay race
    expect(peak).toBeLessThanOrEqual(0.55 * DEG);
    expect(peakAtMs).toBeLessThanOrEqual(40);
    // Semis fully recover before the next possible shot (240 ms refire).
    expect(kick.pitchOffset).toBeLessThan(0.55 * DEG * 0.12);
  });

  it("alternates lateral sign deterministically — no RNG", () => {
    const a = new CameraKick();
    a.fire(WeaponId.Shotgun, false);
    a.update(30);
    const first = a.yawOffset;
    expect(first).not.toBe(0);

    const b = new CameraKick();
    b.fire(WeaponId.Shotgun, false);
    b.update(30);
    expect(b.yawOffset).toBe(first); // identical run = identical kick

    b.fire(WeaponId.Shotgun, false);
    b.update(500);
    b.fire(WeaponId.Shotgun, false); // third shot: back to positive lane
    b.update(30);
    expect(Math.sign(b.yawOffset)).toBe(Math.sign(first));
  });

  it("held SMG fire plateaus under the 0.35 deg honesty bound", () => {
    const kick = new CameraKick();
    // 85 ms refire cadence for 2 seconds of held fire.
    for (let shot = 0; shot < 24; shot += 1) {
      kick.fire(WeaponId.Smg, false);
      settle(kick, 85);
    }
    expect(kick.pitchOffset).toBeLessThan(0.35 * DEG);
  });

  it("scoped kick scales by the ADS factor; beam and knife are zero", () => {
    const scoped = new CameraKick();
    scoped.fire(WeaponId.Scout, true);
    const unscoped = new CameraKick();
    unscoped.fire(WeaponId.Scout, false);
    scoped.update(40);
    unscoped.update(40);
    expect(scoped.pitchOffset).toBeCloseTo(unscoped.pitchOffset * 0.45, 6);

    const none = new CameraKick();
    none.fire(WeaponId.Knife, false);
    none.fire(WeaponId.Arc, false);
    none.update(40);
    expect(none.pitchOffset).toBe(0);
    expect(none.yawOffset).toBe(0);
  });
});
