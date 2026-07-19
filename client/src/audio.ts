import { WeaponId, type WeaponIdValue } from "../../packages/shared/src/index.js";

export type SurfaceMaterial = "concrete" | "metal" | "stone";

export interface SynthRecipe {
  readonly duration: number;
  readonly attack: number;
  readonly decay: number;
  readonly noiseMix: number;
  readonly toneHz: number;
  readonly pitchDrop: number;
  readonly filterHz: number;
  readonly gain: number;
}

const recipe = (
  duration: number,
  noiseMix: number,
  toneHz: number,
  filterHz: number,
  gain: number,
  pitchDrop = 0.35,
): SynthRecipe => ({ duration, attack: 0.002, decay: duration * 0.78, noiseMix, toneHz, pitchDrop, filterHz, gain });

export const FIRE_RECIPES: Readonly<Record<WeaponIdValue, SynthRecipe>> = Object.freeze({
  [WeaponId.Pistol]: recipe(0.13, 0.62, 150, 2_600, 0.55),
  [WeaponId.Smg]: recipe(0.075, 0.58, 190, 3_200, 0.38),
  [WeaponId.Shotgun]: recipe(0.3, 0.88, 72, 1_650, 0.72, 0.55),
  [WeaponId.Rifle]: recipe(0.095, 0.7, 125, 2_900, 0.48),
  [WeaponId.Scout]: recipe(0.34, 0.72, 92, 2_200, 0.7, 0.62),
  [WeaponId.Knife]: recipe(0.11, 0.8, 620, 5_400, 0.3, 0.08),
  [WeaponId.Sidewinder]: recipe(0.16, 0.5, 118, 2_800, 0.58),
  [WeaponId.Boomstick]: recipe(0.4, 0.9, 58, 1_400, 0.78, 0.66),
  [WeaponId.Arc]: recipe(0.06, 0.35, 740, 6_200, 0.28, 0.05),
  [WeaponId.Peacemaker]: recipe(0.25, 0.82, 66, 1_800, 0.7, 0.58),
  [WeaponId.Discus]: recipe(0.18, 0.32, 410, 4_800, 0.48, 0.15),
  [WeaponId.Deadeye]: recipe(0.29, 0.6, 105, 2_500, 0.65, 0.55),
  [WeaponId.Goldie]: recipe(0.32, 0.4, 128, 3_600, 0.68, 0.7),
});

export const IMPACT_RECIPES: Readonly<Record<WeaponIdValue, SynthRecipe>> = Object.freeze(
  Object.fromEntries(Object.values(WeaponId).map((id) => [
    id,
    recipe(id === WeaponId.Knife ? 0.09 : 0.12, 0.76, 260 + id * 19, 4_200, 0.3, 0.12),
  ])) as Record<WeaponIdValue, SynthRecipe>,
);

export function validateRecipe(value: SynthRecipe): boolean {
  return Object.values(value).every(Number.isFinite) &&
    value.duration > 0 && value.duration <= 2 && value.attack >= 0 &&
    value.decay > 0 && value.decay <= value.duration &&
    value.noiseMix >= 0 && value.noiseMix <= 1 &&
    value.toneHz > 0 && value.filterHz > 0 &&
    value.gain >= 0 && value.gain <= 0.9 &&
    value.pitchDrop >= 0 && value.pitchDrop <= 1;
}

/** Deterministic PCM oracle used by tests and by the Web Audio runtime. */
export function renderRecipe(
  value: SynthRecipe,
  sampleRate = 48_000,
  seed = 0x9e3779b9,
): Float32Array<ArrayBuffer> {
  if (!validateRecipe(value)) throw new RangeError("invalid synth recipe");
  const samples = new Float32Array(Math.ceil(value.duration * sampleRate));
  let random = seed >>> 0;
  let phase = 0;
  let filteredNoise = 0;
  const filterAlpha = Math.min(1, (2 * Math.PI * value.filterHz) / sampleRate);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
    const white = random / 0xffff_ffff * 2 - 1;
    filteredNoise += (white - filteredNoise) * filterAlpha;
    const progress = time / value.duration;
    const frequency = value.toneHz * (1 - progress * value.pitchDrop);
    phase += 2 * Math.PI * frequency / sampleRate;
    const attack = value.attack === 0 ? 1 : Math.min(1, time / value.attack);
    const tail = Math.exp(-Math.max(0, time - value.attack) / value.decay * 6);
    const mixed = Math.sin(phase) * (1 - value.noiseMix) + filteredNoise * value.noiseMix;
    samples[index] = Math.max(-1, Math.min(1, mixed * attack * tail * value.gain));
  }
  return samples;
}

export class GameAudio {
  private context: AudioContext | undefined;
  private windGain: GainNode | undefined;
  private ambienceGain: GainNode | undefined;
  private seed = 1;

  unlock(): void {
    this.context ??= new AudioContext();
    void this.context.resume();
    this.ensureLoops();
  }

  playFire(weaponId: WeaponIdValue, position?: { x: number; y: number; z: number }): void {
    this.play(FIRE_RECIPES[weaponId], position);
  }

  playImpact(weaponId: WeaponIdValue, position?: { x: number; y: number; z: number }): void {
    this.play(IMPACT_RECIPES[weaponId], position);
  }

  hitmarker(damage: number): void {
    this.tone(220 + Math.max(0, Math.min(100, damage)) * 5.2, 0.052, 0.085);
  }

  headshot(): void {
    this.tone(1_120, 0.12, 0.095);
  }

  killConfirm(): void {
    this.tone(690, 0.15, 0.12);
    this.tone(920, 0.11, 0.1, 0.045);
  }

  airshot(): void {
    this.tone(1_380, 0.2, 0.12);
    this.tone(1_840, 0.16, 0.09, 0.055);
  }

  foundrySigil(): void {
    [392, 523.25, 659.25, 783.99].forEach((frequency, index) =>
      this.tone(frequency, 0.24, 0.09, index * 0.095));
  }

  footstep(material: SurfaceMaterial): void {
    const params = material === "metal"
      ? recipe(0.07, 0.62, 360, 5_500, 0.15, 0.12)
      : material === "stone"
        ? recipe(0.09, 0.82, 145, 2_500, 0.17, 0.25)
        : recipe(0.08, 0.75, 190, 3_200, 0.16, 0.2);
    this.play(params);
  }

  landing(material: SurfaceMaterial, speed: number): void {
    const base = material === "metal" ? 240 : material === "stone" ? 105 : 140;
    this.play(recipe(0.12, 0.82, base, 2_200, Math.min(0.35, 0.12 + speed * 0.012), 0.3));
  }

  setWindSpeed(speed: number): void {
    this.ensureLoops();
    if (this.context === undefined || this.windGain === undefined) return;
    const gain = Math.max(0, Math.min(0.16, (speed - 5) / 100));
    this.windGain.gain.setTargetAtTime(gain, this.context.currentTime, 0.08);
  }

  setSpireSecretAmbience(active: boolean): void {
    this.ensureLoops();
    if (this.context === undefined || this.ambienceGain === undefined) return;
    this.ambienceGain.gain.setTargetAtTime(active ? 0.055 : 0, this.context.currentTime, 0.35);
  }

  private play(value: SynthRecipe, position?: { x: number; y: number; z: number }): void {
    if (this.context === undefined) return;
    const samples = renderRecipe(value, this.context.sampleRate, this.seed++);
    const buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    if (position === undefined) source.connect(this.context.destination);
    else {
      const panner = this.context.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 2;
      panner.maxDistance = 90;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      source.connect(panner).connect(this.context.destination);
    }
    source.start();
  }

  private tone(frequency: number, duration: number, gainValue: number, delay = 0): void {
    if (this.context === undefined) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(Math.max(0.0001, gainValue), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  private ensureLoops(): void {
    if (this.context === undefined || this.windGain !== undefined) return;
    const makeNoiseLoop = (filterHz: number): { source: AudioBufferSourceNode; gain: GainNode } => {
      const samples = renderRecipe(recipe(1, 1, 80, filterHz, 0.65, 0), this.context!.sampleRate, this.seed++);
      const buffer = this.context!.createBuffer(1, samples.length, this.context!.sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = this.context!.createBufferSource();
      const gain = this.context!.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = 0;
      source.connect(gain).connect(this.context!.destination);
      source.start();
      return { source, gain };
    };
    this.windGain = makeNoiseLoop(1_800).gain;
    this.ambienceGain = makeNoiseLoop(320).gain;
  }
}
