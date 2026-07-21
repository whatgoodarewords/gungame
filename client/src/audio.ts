import { NEAR_MISS_DIALS, WeaponId, type WeaponIdValue } from "../../packages/shared/src/index.js";
import { AUDIO_SAMPLE_URLS } from "./asset-manifest.js";
import { GUNSHOT_PARAMS, renderGunshot } from "./gunshot-synth.js";

export type SurfaceMaterial = "concrete" | "metal" | "stone";

export const MASTER_COMPRESSOR_DIALS = Object.freeze({
  thresholdDb: -12,
  kneeDb: 12,
  ratio: 3,
  attackSeconds: 0.004,
  releaseSeconds: 0.16,
});

export const GUNSHOT_LAYERS = Object.freeze([
  "mechanical",
  "body",
  "tail",
] as const);

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
  private readonly gunshotBuffers = new Map<number, AudioBuffer>();
  private master: GainNode | undefined;
  private compressor: DynamicsCompressorNode | undefined;
  private windGain: GainNode | undefined;
  private ambienceGain: GainNode | undefined;
  private ambienceFilter: BiquadFilterNode | undefined;
  private captureDestination: MediaStreamAudioDestinationNode | undefined;
  private seed = 1;
  private volume = 0.8;
  private muted = false;
  private readonly samples = new Map<string, AudioBuffer>();
  private preloadStarted = false;
  private footstepIndex = 0;

  unlock(): void {
    this.context ??= new AudioContext();
    this.ensureMaster();
    void this.context.resume();
    this.ensureLoops();
    this.preloadSamples();
    this.prerenderGunshots();
  }

  /** Render every designed gunshot once at unlock: zero first-shot DSP cost. */
  private prerenderGunshots(): void {
    if (this.context === undefined || this.gunshotBuffers.size > 0) return;
    for (const [id, params] of Object.entries(GUNSHOT_PARAMS)) {
      if (params === undefined) continue;
      const samples = renderGunshot(params, this.context.sampleRate);
      const buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
      buffer.copyToChannel(samples, 0);
      this.gunshotBuffers.set(Number(id), buffer);
    }
  }

  private playGunshot(
    weaponId: WeaponIdValue,
    position?: { x: number; y: number; z: number },
  ): boolean {
    if (this.context === undefined) return false;
    this.prerenderGunshots();
    const buffer = this.gunshotBuffers.get(weaponId);
    if (buffer === undefined) return false;
    this.ensureMaster();
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    if (position === undefined) source.connect(this.master!);
    else {
      const panner = this.context.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 2;
      panner.maxDistance = 90;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      source.connect(panner).connect(this.master!);
    }
    source.start();
    return true;
  }

  setMaster(volume: number, muted: boolean): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.muted = muted;
    this.ensureMaster();
    if (this.context !== undefined && this.master !== undefined) {
      this.master.gain.setTargetAtTime(
        muted ? 0 : this.volume,
        this.context.currentTime,
        0.015,
      );
    }
  }

  get captureStream(): MediaStream | undefined {
    return this.captureDestination?.stream;
  }

  setListener(
    position: { x: number; y: number; z: number },
    forward: { x: number; y: number; z: number },
  ): void {
    if (this.context === undefined) return;
    const listener = this.context.listener;
    listener.positionX.value = position.x;
    listener.positionY.value = position.y;
    listener.positionZ.value = position.z;
    listener.forwardX.value = forward.x;
    listener.forwardY.value = forward.y;
    listener.forwardZ.value = forward.z;
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
  }

  playFire(weaponId: WeaponIdValue, position?: { x: number; y: number; z: number }): void {
    // Designed four-layer gunshots (gunshot-synth) carry ballistic weapons
    // whole — no extra layers needed, the crack/body/thump/tail are baked in.
    if (this.playGunshot(weaponId, position)) return;
    const sampled = weaponId === WeaponId.Arc
      ? AUDIO_SAMPLE_URLS.laserSmall
      : weaponId === WeaponId.Peacemaker
        ? AUDIO_SAMPLE_URLS.forceField
        : weaponId === WeaponId.Discus
          ? AUDIO_SAMPLE_URLS.laserRetro
          : undefined;
    const sampledBody = sampled !== undefined && this.playSample(sampled, position, 0.55);
    if (!sampledBody) this.play(FIRE_RECIPES[weaponId], position);
    // Mechanical transient + room tail for the non-designed paths.
    this.play(recipe(0.022, 0.32, 1_180 + weaponId * 23, 7_500, 0.11, 0.04),
      position, 1, 0);
    this.play(recipe(0.22, 0.58, 82 + weaponId * 3, 1_500, 0.13, 0.18),
      position, 1, 0.035);
  }

  playImpact(weaponId: WeaponIdValue, position?: { x: number; y: number; z: number }): void {
    const sampled = weaponId === WeaponId.Peacemaker || weaponId === WeaponId.Discus
      ? AUDIO_SAMPLE_URLS.explosion
      : AUDIO_SAMPLE_URLS.impactGeneric;
    if (this.playSample(sampled, position, 0.65)) return;
    this.play(IMPACT_RECIPES[weaponId], position);
  }

  hitmarker(damage: number): void {
    this.tone(220 + Math.max(0, Math.min(100, damage)) * 5.2, 0.052, 0.085);
  }

  headshot(): void {
    this.tone(1_120, 0.12, 0.095);
  }

  killConfirm(streak = 1): void {
    const rise = Math.min(4, Math.max(0, streak - 1)) * 55;
    this.tone(690 + rise, 0.15, 0.12);
    this.tone(920 + rise, 0.11, 0.1, 0.045);
  }

  airshot(): void {
    this.tone(1_380, 0.2, 0.12);
    this.tone(1_840, 0.16, 0.09, 0.055);
  }

  impressive(chain: number): void {
    const lift = Math.min(3, Math.max(0, chain / 2 - 1)) * 18;
    this.voicedTone(294 + lift, 0.19, 0.075);
    this.voicedTone(440 + lift, 0.25, 0.065, 0.105);
  }

  foundrySigil(): void {
    [392, 523.25, 659.25, 783.99].forEach((frequency, index) =>
      this.tone(frequency, 0.24, 0.09, index * 0.095));
  }

  tierUp(): void {
    this.tone(520, 0.14, 0.08);
    this.tone(780, 0.18, 0.09, 0.07);
  }

  lastTierWarning(): void {
    this.tone(185, 0.28, 0.055);
    this.tone(247, 0.32, 0.045, 0.11);
  }

  footstep(
    material: SurfaceMaterial,
    position?: { x: number; y: number; z: number },
    own = true,
  ): void {
    const footstepUrl = AUDIO_SAMPLE_URLS.footstepConcrete[
      this.footstepIndex++ % AUDIO_SAMPLE_URLS.footstepConcrete.length
    ]!;
    if (material !== "metal" && this.playSample(footstepUrl, position, own ? 0.24 : 0.44)) return;
    if (material === "metal" && this.playSample(AUDIO_SAMPLE_URLS.impactMetal, position, own ? 0.1 : 0.2, 1.4)) {
      return;
    }
    const params = material === "metal"
      ? recipe(0.07, 0.62, 360, 5_500, 0.15, 0.12)
      : material === "stone"
        ? recipe(0.09, 0.82, 145, 2_500, 0.17, 0.25)
        : recipe(0.08, 0.75, 190, 3_200, 0.16, 0.2);
    this.play(params, position, own ? 0.55 : 1);
  }

  landing(material: SurfaceMaterial, speed: number): void {
    const sample = material === "metal"
      ? AUDIO_SAMPLE_URLS.impactMetal
      : AUDIO_SAMPLE_URLS.impactGeneric;
    if (this.playSample(sample, undefined, Math.min(0.44, 0.12 + speed * 0.018), 0.8)) return;
    const base = material === "metal" ? 240 : material === "stone" ? 105 : 140;
    this.play(recipe(0.12, 0.82, base, 2_200, Math.min(0.35, 0.12 + speed * 0.012), 0.3));
  }

  projectileWhoosh(position: { x: number; y: number; z: number }, distance: number): void {
    if (distance > 7) return;
    this.play(
      recipe(0.09, 0.48, 180 + (7 - distance) * 24, 3_800, 0.13, 0.08),
      position,
      Math.max(0.15, 1 - distance / 7),
    );
  }

  nearMiss(
    position: { x: number; y: number; z: number },
    closingSpeed: number,
    hitscan: boolean,
  ): void {
    const speed = Math.max(0, closingSpeed);
    const doppler = 1 + Math.min(0.7, speed / 70 * NEAR_MISS_DIALS.dopplerAmount);
    if (hitscan) {
      this.play(recipe(0.075, 0.82, 1_050, 7_200, NEAR_MISS_DIALS.hitscanGain, 0.06),
        position);
      return;
    }
    this.play(recipe(0.16, 0.58, 175 * doppler, 4_600,
      NEAR_MISS_DIALS.projectileGain, 0.14), position);
  }

  uiClick(): void {
    if (!this.playSample(AUDIO_SAMPLE_URLS.uiClick, undefined, 0.35)) {
      this.tone(360, 0.035, 0.045);
    }
  }

  uiConfirm(): void {
    if (!this.playSample(AUDIO_SAMPLE_URLS.uiConfirm, undefined, 0.42)) {
      this.tone(720, 0.07, 0.06);
    }
  }

  uiError(): void {
    if (!this.playSample(AUDIO_SAMPLE_URLS.uiError, undefined, 0.42)) {
      this.tone(180, 0.09, 0.06);
    }
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
    this.ambienceGain.gain.setTargetAtTime(active ? 0.055 : 0.024, this.context.currentTime, 0.35);
  }

  setRoomTone(map: "spire" | "foundry" | "duna" | "cascade" | string): void {
    this.ensureLoops();
    if (this.context === undefined || this.ambienceGain === undefined ||
      this.ambienceFilter === undefined) return;
    const frequency = map === "spire" ? 510 : map === "duna" ? 230 : map === "cascade" ? 380 : 310;
    this.ambienceFilter.frequency.setTargetAtTime(frequency, this.context.currentTime, 0.45);
    this.ambienceGain.gain.setTargetAtTime(0.024, this.context.currentTime, 0.45);
  }

  private play(
    value: SynthRecipe,
    position?: { x: number; y: number; z: number },
    gainScale = 1,
    delaySeconds = 0,
  ): void {
    if (this.context === undefined) return;
    this.ensureMaster();
    const samples = renderRecipe(value, this.context.sampleRate, this.seed++);
    const buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    gain.gain.value = gainScale;
    source.buffer = buffer;
    if (position === undefined) source.connect(gain).connect(this.master!);
    else {
      const panner = this.context.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 2;
      panner.maxDistance = 90;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      source.connect(panner).connect(gain).connect(this.master!);
    }
    source.start(this.context.currentTime + delaySeconds);
  }

  private playSample(
    url: string,
    position?: { x: number; y: number; z: number },
    gainValue = 1,
    playbackRate = 1,
  ): boolean {
    if (this.context === undefined) return false;
    const buffer = this.samples.get(url);
    if (buffer === undefined) return false;
    this.ensureMaster();
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    gain.gain.value = gainValue;
    if (position === undefined) source.connect(gain).connect(this.master!);
    else {
      const panner = this.context.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 2;
      panner.maxDistance = 90;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      source.connect(panner).connect(gain).connect(this.master!);
    }
    source.start();
    return true;
  }

  private preloadSamples(): void {
    if (this.preloadStarted || this.context === undefined) return;
    this.preloadStarted = true;
    const urls = new Set<string>([
      ...AUDIO_SAMPLE_URLS.footstepConcrete,
      AUDIO_SAMPLE_URLS.impactGeneric,
      AUDIO_SAMPLE_URLS.impactMetal,
      AUDIO_SAMPLE_URLS.uiClick,
      AUDIO_SAMPLE_URLS.uiConfirm,
      AUDIO_SAMPLE_URLS.uiError,
      AUDIO_SAMPLE_URLS.explosion,
      AUDIO_SAMPLE_URLS.forceField,
      AUDIO_SAMPLE_URLS.laserLarge,
      AUDIO_SAMPLE_URLS.laserRetro,
      AUDIO_SAMPLE_URLS.laserSmall,
    ]);
    for (const url of urls) {
      void fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(`audio HTTP ${response.status}`);
          return response.arrayBuffer();
        })
        .then((bytes) => this.context!.decodeAudioData(bytes))
        .then((buffer) => this.samples.set(url, buffer))
        .catch((error: unknown) => console.warn("audio sample unavailable", error));
    }
  }

  private tone(frequency: number, duration: number, gainValue: number, delay = 0): void {
    if (this.context === undefined) return;
    this.ensureMaster();
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(Math.max(0.0001, gainValue), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.master!);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  private voicedTone(frequency: number, duration: number, gainValue: number, delay = 0): void {
    if (this.context === undefined) return;
    this.ensureMaster();
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const formant = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.94, start + duration);
    formant.type = "bandpass";
    formant.frequency.value = frequency < 400 ? 760 : 1_180;
    formant.Q.value = 3.8;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(formant).connect(gain).connect(this.master!);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  private ensureLoops(): void {
    if (this.context === undefined || this.windGain !== undefined) return;
    const makeNoiseLoop = (
      filterHz: number,
    ): { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } => {
      const samples = renderRecipe(recipe(1, 1, 80, filterHz, 0.65, 0), this.context!.sampleRate, this.seed++);
      const buffer = this.context!.createBuffer(1, samples.length, this.context!.sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = this.context!.createBufferSource();
      const gain = this.context!.createGain();
      const filter = this.context!.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = filterHz;
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master!);
      source.start();
      return { source, gain, filter };
    };
    this.windGain = makeNoiseLoop(1_800).gain;
    const ambience = makeNoiseLoop(320);
    this.ambienceGain = ambience.gain;
    this.ambienceFilter = ambience.filter;
  }

  private ensureMaster(): void {
    if (this.context === undefined || this.master !== undefined) return;
    this.master = this.context.createGain();
    this.compressor = this.context.createDynamicsCompressor();
    this.captureDestination = this.context.createMediaStreamDestination();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.compressor.threshold.value = MASTER_COMPRESSOR_DIALS.thresholdDb;
    this.compressor.knee.value = MASTER_COMPRESSOR_DIALS.kneeDb;
    this.compressor.ratio.value = MASTER_COMPRESSOR_DIALS.ratio;
    this.compressor.attack.value = MASTER_COMPRESSOR_DIALS.attackSeconds;
    this.compressor.release.value = MASTER_COMPRESSOR_DIALS.releaseSeconds;
    this.master.connect(this.compressor);
    this.compressor.connect(this.context.destination);
    this.compressor.connect(this.captureDestination);
  }
}
