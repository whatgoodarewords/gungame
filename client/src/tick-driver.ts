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

  get alpha(): number {
    return Math.min(1, this.accumulatorSeconds / this.tickSeconds);
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
