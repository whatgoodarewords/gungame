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
  /** Median raw frame time over the ring (ms). */
  readonly frameMedian: number;
  /** p99 raw frame time over the ring (ms) — jitter budget, not average fps. */
  readonly frameP99: number;
}

const SMOOTHING = 0.08;
const FRAME_RING = 512;

/**
 * Fixed-capacity percentile tracker over a ring of raw samples. The per-frame
 * read path (cached p50/p95/p99 fields) neither sorts nor allocates; the sort
 * is throttled into recompute() so it stays off the hot path. recompute() itself
 * allocates two small typed-array views — negligible at its ~2 Hz cadence.
 */
class PercentileRing {
  private readonly ring: Float64Array;
  private readonly scratch: Float64Array;
  private length = 0;
  private head = 0;
  private sinceCompute = 0;
  private readonly recomputeEvery: number;
  // Cached on the throttled recompute so per-frame reads never sort.
  p50 = 0;
  p95 = 0;
  p99 = 0;
  constructor(capacity: number, recomputeEvery = 30) {
    this.ring = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
    this.recomputeEvery = recomputeEvery;
  }
  push(value: number): void {
    this.ring[this.head] = value;
    this.head = (this.head + 1) % this.ring.length;
    if (this.length < this.ring.length) this.length += 1;
    if (++this.sinceCompute >= this.recomputeEvery) this.recompute();
  }
  /** Sort the live window once and refresh the cached percentiles. */
  recompute(): void {
    this.sinceCompute = 0;
    if (this.length === 0) return;
    const view = this.scratch.subarray(0, this.length);
    view.set(this.ring.subarray(0, this.length));
    view.sort();
    const at = (p: number): number =>
      view[Math.min(this.length - 1, Math.max(0, Math.round(p * (this.length - 1))))]!;
    this.p50 = at(0.5);
    this.p95 = at(0.95);
    this.p99 = at(0.99);
  }
}

/**
 * Rolling input→photon latency estimate. `markInput` stamps the DOM event's
 * timestamp (same timebase as performance.now() for trusted events); the render
 * loop calls `sampleAtPresent` with the rAF frame time once the response frame
 * is drawn. "This number is the product" (native-feel §1). (F4)
 */
export class LatencyEstimator {
  private pendingEventMs = -1;
  // Clicks are sparse, so recompute every push keeps the readout responsive.
  private readonly ring = new PercentileRing(128, 1);
  private samples = 0;
  medianMs = 0;
  p95Ms = 0;
  /**
   * Record the click that a shot will answer. Latest-wins: an input that never
   * produces a photon (fired during refire cooldown or while dead) is harmlessly
   * overwritten by the next real click rather than lingering and mis-attaching.
   */
  markInput(eventMs: number): void {
    this.pendingEventMs = eventMs;
  }
  /**
   * Close the pending sample against the presenting frame. Call this ONLY on a
   * frame that actually drew the shot's response (a real photon) so cooldown/
   * dead clicks never pollute the distribution with flattering no-op samples.
   */
  sampleAtPresent(frameNowMs: number): void {
    if (this.pendingEventMs < 0) return;
    const latency = frameNowMs - this.pendingEventMs;
    this.pendingEventMs = -1;
    if (latency < 0 || latency > 1_000) return; // reject clock skew / tab-restore
    this.ring.push(latency);
    this.samples += 1;
    this.medianMs = this.ring.p50;
    this.p95Ms = this.ring.p95;
  }
  get sampleCount(): number {
    return this.samples;
  }
}

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
  private readonly frameRing = new PercentileRing(FRAME_RING, 30);
  private readonly snapshotValue: FrameBreakdown = {
    frame: 0,
    render: 0,
    lighting: 0,
    post: 0,
    particles: 0,
    characters: 0,
    frameMedian: 0,
    frameP99: 0,
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
    const raw = Math.max(0, now - this.frameStartedAt);
    this.frameMs = this.smooth(this.frameMs, raw);
    this.frameRing.push(raw);
  }

  get snapshot(): FrameBreakdown {
    const mutable = this.snapshotValue as { -readonly [K in keyof FrameBreakdown]: number };
    mutable.frame = this.frameMs;
    mutable.render = this.renderMs;
    mutable.lighting = this.lightingMs;
    mutable.post = this.postMs;
    mutable.particles = this.particlesMs;
    mutable.characters = this.charactersMs;
    mutable.frameMedian = this.frameRing.p50;
    mutable.frameP99 = this.frameRing.p99;
    return this.snapshotValue;
  }

  private smooth(previous: number, value: number): number {
    return previous === 0 ? value : previous + (value - previous) * SMOOTHING;
  }
}
