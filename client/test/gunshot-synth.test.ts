import { describe, expect, it } from "vitest";

import { WeaponId } from "@gungame/shared";

import { GUNSHOT_PARAMS, renderGunshot } from "../src/gunshot-synth.js";

describe("designed gunshot synthesis", () => {
  it("is deterministic: same weapon renders the identical waveform", () => {
    const params = GUNSHOT_PARAMS[WeaponId.Rifle]!;
    const a = renderGunshot(params, 48_000);
    const b = renderGunshot(params, 48_000);
    expect(a).toEqual(b);
  });

  it("peak-normalizes to the weapon's gain (stable compressor input)", () => {
    for (const id of [WeaponId.Pistol, WeaponId.Shotgun, WeaponId.Goldie] as const) {
      const params = GUNSHOT_PARAMS[id]!;
      const samples = renderGunshot(params, 48_000);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeCloseTo(params.gain, 5);
    }
  });

  it("front-loads energy: the crack window dominates the late tail", () => {
    const params = GUNSHOT_PARAMS[WeaponId.Pistol]!;
    const samples = renderGunshot(params, 48_000);
    const rms = (from: number, to: number): number => {
      let sum = 0;
      for (let i = from; i < to; i += 1) sum += samples[i]! * samples[i]!;
      return Math.sqrt(sum / (to - from));
    };
    const early = rms(0, 480); // first 10 ms
    const late = rms(samples.length - 2_400, samples.length); // last 50 ms
    expect(early).toBeGreaterThan(late * 4);
  });

  it("class identity: the boomstick carries far more sub weight than the smg", () => {
    // Compare sub-band energy via a crude 120 Hz one-pole lowpass.
    const subEnergy = (id: (typeof WeaponId)[keyof typeof WeaponId]): number => {
      const samples = renderGunshot(GUNSHOT_PARAMS[id]!, 48_000);
      const alpha = (2 * Math.PI * 120) / 48_000;
      let lp = 0;
      let sum = 0;
      for (const v of samples) {
        lp += (v - lp) * alpha;
        sum += lp * lp;
      }
      return sum; // total (not mean): longer booms SHOULD count for more
    };
    expect(subEnergy(WeaponId.Boomstick)).toBeGreaterThan(subEnergy(WeaponId.Smg) * 4);
  });

  it("every ballistic weapon in the table renders a bounded, finite buffer", () => {
    for (const [, params] of Object.entries(GUNSHOT_PARAMS)) {
      if (params === undefined) continue;
      const samples = renderGunshot(params, 48_000);
      expect(samples.length).toBe(Math.ceil(params.duration * 48_000));
      let bad = 0;
      for (const v of samples) {
        if (!Number.isFinite(v) || Math.abs(v) > 1) bad += 1;
      }
      expect(bad).toBe(0);
    }
  });
});
