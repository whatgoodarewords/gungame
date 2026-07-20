export type TickSchedule = (callback: () => void, delayMs: number) => unknown;

/** Fixed-step sim/network driver intentionally independent from rendering/rAF. */
export class OffRenderTickDriver {
  private previousMs: number;
  private accumulatorSeconds = 0;
  private running = false;
  private readonly tick: () => void;
  private readonly now: () => number;
  private readonly schedule: TickSchedule;
  private readonly tickSeconds: number;

  constructor(
    tick: () => void,
    now: () => number = () => performance.now(),
    schedule: TickSchedule = (callback, delayMs) => setTimeout(callback, delayMs),
    tickSeconds = 1 / 64,
  ) {
    this.tick = tick;
    this.now = now;
    this.schedule = schedule;
    this.tickSeconds = tickSeconds;
    this.previousMs = now();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previousMs = this.now();
    this.schedule(this.loop, 0);
  }

  stop(): void {
    this.running = false;
  }

  /**
   * Sub-tick interpolation phase evaluated at `nowMs` rather than at the last
   * driver wake. The accumulator + previousMs pair is only refreshed when the
   * loop fires (a ~4 ms setTimeout, imprecise), so reading a bare accumulator
   * from a 120–144 Hz render loop yields an alpha that is stale by a varying
   * fraction of a tick every frame — visible as local-motion judder. Extrapolate
   * forward to the caller's own clock instead. (F3)
   */
  alphaAt(nowMs: number): number {
    const seconds = this.accumulatorSeconds + Math.max(0, (nowMs - this.previousMs) / 1_000);
    return Math.min(1, seconds / this.tickSeconds);
  }

  get alpha(): number {
    return this.alphaAt(this.now());
  }

  /** Wall-clock time of the most recent consumed tick boundary (for fireFraction). */
  get lastTickAtMs(): number {
    return this.previousMs - this.accumulatorSeconds * 1_000;
  }

  private readonly loop = (): void => {
    if (!this.running) return;
    const currentMs = this.now();
    this.accumulatorSeconds += Math.min(0.25, Math.max(0, (currentMs - this.previousMs) / 1_000));
    this.previousMs = currentMs;
    let catchUpTicks = 0;
    while (this.accumulatorSeconds >= this.tickSeconds && catchUpTicks < 4) {
      this.tick();
      this.accumulatorSeconds -= this.tickSeconds;
      catchUpTicks += 1;
    }
    if (catchUpTicks === 4 && this.accumulatorSeconds >= this.tickSeconds) {
      this.accumulatorSeconds = 0;
    }
    this.schedule(this.loop, 4);
  };
}
