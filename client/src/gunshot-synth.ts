// Designed gunshot synthesis (the anti-"cheap" pass). The old fire sound was
// one sine + one-pole-lowpassed noise — a beep in a pillow. A gunshot that
// reads as a gun is four layers with distinct time constants:
//
//   1. CRACK   (0-8 ms)   high-passed noise burst, hard decay — the snap
//   2. BODY    (0-90 ms)  band-shaped noise with drive — the report
//   3. THUMP   (0-120 ms) 110→45 Hz sine sweep — the chest hit
//   4. TAIL    (25-220 ms) damped metallic partials + quiet noise — the room
//
// The sum is soft-clipped (tanh) for loudness density, then peak-normalized.
// Deterministic per weapon (fixed seed): every pistol shot is THE pistol
// sound — sample-accurate identity, zero per-shot DSP (buffers are cached).

import { WeaponId, type WeaponIdValue } from "@gungame/shared";

export interface GunshotParams {
  /** Crack loudness 0..1 — the high snap. */
  readonly crack: number;
  /** Body center frequency Hz (report color: low = boom, high = bark). */
  readonly bodyHz: number;
  /** Body decay time constant, seconds. */
  readonly bodyDecay: number;
  /** Body loudness 0..1. */
  readonly body: number;
  /** Drive into the soft-clip (aggression). */
  readonly drive: number;
  /** Sub-thump loudness 0..1. */
  readonly thump: number;
  /** Tail partial frequencies, Hz (mechanical ring). */
  readonly tailHz: readonly number[];
  /** Tail loudness 0..1. */
  readonly tail: number;
  /** Total render length, seconds. */
  readonly duration: number;
  /** Output gain after normalization. */
  readonly gain: number;
}

const shot = (value: Partial<GunshotParams> & Pick<GunshotParams, "bodyHz">): GunshotParams => ({
  crack: 0.8,
  bodyDecay: 0.028,
  body: 0.9,
  drive: 1.6,
  thump: 0.5,
  tailHz: [1_320, 2_680],
  tail: 0.16,
  duration: 0.24,
  gain: 0.5,
  ...value,
});

/** Class-archetype table: every weapon gets an identity, not a pitch shift. */
export const GUNSHOT_PARAMS: Readonly<Partial<Record<WeaponIdValue, GunshotParams>>> =
  Object.freeze({
    [WeaponId.Pistol]: shot({ bodyHz: 520, bodyDecay: 0.022, drive: 1.7, thump: 0.42, gain: 0.5 }),
    [WeaponId.Smg]: shot({
      bodyHz: 640, bodyDecay: 0.014, crack: 0.7, body: 0.8, thump: 0.3,
      duration: 0.15, tail: 0.1, gain: 0.42,
    }),
    [WeaponId.Shotgun]: shot({
      bodyHz: 210, bodyDecay: 0.05, crack: 0.75, body: 1, drive: 2.2, thump: 0.85,
      duration: 0.34, tailHz: [960, 1_840], tail: 0.2, gain: 0.62,
    }),
    [WeaponId.Rifle]: shot({
      bodyHz: 460, bodyDecay: 0.02, crack: 0.9, drive: 2.0, thump: 0.45,
      duration: 0.2, gain: 0.48,
    }),
    [WeaponId.Scout]: shot({
      bodyHz: 300, bodyDecay: 0.055, crack: 1, drive: 2.1, thump: 0.75,
      duration: 0.42, tailHz: [1_150, 2_300, 3_400], tail: 0.24, gain: 0.6,
    }),
    [WeaponId.Sidewinder]: shot({ bodyHz: 560, bodyDecay: 0.024, drive: 1.8, thump: 0.46, gain: 0.5 }),
    [WeaponId.Boomstick]: shot({
      bodyHz: 170, bodyDecay: 0.06, crack: 0.7, body: 1, drive: 2.4, thump: 0.95,
      duration: 0.4, tailHz: [820, 1_620], tail: 0.22, gain: 0.66,
    }),
    [WeaponId.Deadeye]: shot({
      bodyHz: 330, bodyDecay: 0.05, crack: 0.95, drive: 2.0, thump: 0.7,
      duration: 0.38, tailHz: [1_240, 2_500], tail: 0.22, gain: 0.58,
    }),
    [WeaponId.Goldie]: shot({
      bodyHz: 280, bodyDecay: 0.06, crack: 1, drive: 2.2, thump: 0.8,
      duration: 0.5, tailHz: [1_040, 2_080, 4_160], tail: 0.3, gain: 0.64,
    }),
  });

/** Deterministic render — same weapon, same waveform, forever. */
export function renderGunshot(
  params: GunshotParams,
  sampleRate = 48_000,
  seed = 0x51ab_7e11,
): Float32Array<ArrayBuffer> {
  const length = Math.ceil(params.duration * sampleRate);
  const out = new Float32Array(length);
  let random = seed >>> 0;
  const next = (): number => {
    random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
    return random / 0xffff_ffff * 2 - 1;
  };

  // One-pole state for crack highpass and the 2-pole body bandpass.
  let crackLow = 0;
  let bodyLp1 = 0;
  let bodyLp2 = 0;
  let bodyDeep = 0;
  const crackAlpha = Math.min(1, (2 * Math.PI * 2_400) / sampleRate);
  const bodyAlpha = Math.min(1, (2 * Math.PI * params.bodyHz * 1.6) / sampleRate);
  const deepAlpha = Math.min(1, (2 * Math.PI * params.bodyHz * 0.45) / sampleRate);
  let thumpPhase = 0;
  let peak = 0;

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const white = next();

    // 1. Crack: highpassed white with a 2.5 ms decay.
    crackLow += (white - crackLow) * crackAlpha;
    const crack = (white - crackLow) * Math.exp(-t / 0.0025) * params.crack;

    // 2. Body: band-shaped noise (cascaded lowpass minus deep lowpass).
    bodyLp1 += (white - bodyLp1) * bodyAlpha;
    bodyLp2 += (bodyLp1 - bodyLp2) * bodyAlpha;
    bodyDeep += (bodyLp2 - bodyDeep) * deepAlpha;
    const body = (bodyLp2 - bodyDeep) * Math.exp(-t / params.bodyDecay) * params.body * 3;

    // 3. Thump: pitch-swept sub sine.
    const thumpHz = 110 - Math.min(1, t / 0.12) * 65;
    thumpPhase += (2 * Math.PI * thumpHz) / sampleRate;
    const thump = Math.sin(thumpPhase) * Math.exp(-t / 0.045) * params.thump;

    // 4. Tail: damped metallic partials + quiet noise floor, delayed 25 ms.
    let tail = 0;
    if (t > 0.025) {
      const tt = t - 0.025;
      for (let p = 0; p < params.tailHz.length; p += 1) {
        tail += Math.sin(2 * Math.PI * params.tailHz[p]! * tt) *
          Math.exp(-tt / (0.05 + p * 0.02));
      }
      tail = (tail / Math.max(1, params.tailHz.length) + bodyLp2 * 0.5 * Math.exp(-tt / 0.09)) *
        params.tail;
    }

    // Sum → drive → soft clip. tanh packs loudness density (the "full" read).
    const value = Math.tanh((crack + body + thump + tail) * params.drive);
    out[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }

  // Peak-normalize to the weapon's gain so the compressor sees stable levels.
  if (peak > 0) {
    const scale = params.gain / peak;
    for (let i = 0; i < length; i += 1) out[i]! *= scale;
  }
  return out;
}
