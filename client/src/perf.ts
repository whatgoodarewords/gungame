export const PERF_FEATURES = [
  "lighting",
  "post",
  "particles",
  "characters",
] as const;

export type PerfFeature = (typeof PERF_FEATURES)[number];

export const PERF_BUDGETS = Object.freeze({
  lightingMs: 2,
  postMs: 1,
  particlesMs: 0.5,
  charactersMs: 1,
  drawCalls: 150,
  heapDeltaBytes: 5 * 1024 * 1024,
  coldLoadMs: 5_000,
});

export interface FrameBreakdown {
  readonly frame: number;
  readonly render: number;
  readonly lighting: number;
  readonly post: number;
  readonly particles: number;
  readonly characters: number;
}

const SMOOTHING = 0.08;

/**
 * Allocation-free frame instrumentation. Feature timings are CPU wall time
 * until a backend GPU sample is supplied; the headless budget probe writes
 * those GPU deltas through setGpuFeatureSample().
 */
export class FrameBudgetMeter {
  private frameStartedAt = 0;
  private frameMs = 0;
  private renderMs = 0;
  private lightingMs = 0;
  private postMs = 0;
  private particlesMs = 0;
  private charactersMs = 0;
  private readonly snapshotValue: FrameBreakdown = {
    frame: 0,
    render: 0,
    lighting: 0,
    post: 0,
    particles: 0,
    characters: 0,
  };

  beginFrame(now: number): void {
    this.frameStartedAt = now;
  }

  mark(feature: PerfFeature | "render", elapsedMs: number): void {
    const value = Math.max(0, elapsedMs);
    if (feature === "render") this.renderMs = this.smooth(this.renderMs, value);
    else if (feature === "lighting") this.lightingMs = this.smooth(this.lightingMs, value);
    else if (feature === "post") this.postMs = this.smooth(this.postMs, value);
    else if (feature === "particles") this.particlesMs = this.smooth(this.particlesMs, value);
    else this.charactersMs = this.smooth(this.charactersMs, value);
  }

  setGpuFeatureSample(feature: "lighting" | "post", elapsedMs: number): void {
    this.mark(feature, elapsedMs);
  }

  endFrame(now: number): void {
    this.frameMs = this.smooth(this.frameMs, Math.max(0, now - this.frameStartedAt));
  }

  get snapshot(): FrameBreakdown {
    const mutable = this.snapshotValue as {
      frame: number;
      render: number;
      lighting: number;
      post: number;
      particles: number;
      characters: number;
    };
    mutable.frame = this.frameMs;
    mutable.render = this.renderMs;
    mutable.lighting = this.lightingMs;
    mutable.post = this.postMs;
    mutable.particles = this.particlesMs;
    mutable.characters = this.charactersMs;
    return this.snapshotValue;
  }

  private smooth(previous: number, value: number): number {
    return previous === 0 ? value : previous + (value - previous) * SMOOTHING;
  }
}
