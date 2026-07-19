import { TICK_DT } from "@gungame/shared";

const TICK_MS = TICK_DT * 1_000;
const MAX_CATCH_UP = 4;
const SAMPLE_LIMIT = 4_096;

export interface TickLoopMetrics {
  readonly tick: number;
  readonly aggregateP95Ms: number;
  readonly overloaded: boolean;
}

export class AuthoritativeLoop {
  private accumulatorMs = 0;
  private previousMs = 0;
  private serverTick = 0;
  private overloadUntilMs = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly samples: number[] = [];
  private readonly step: (tick: number, nowMs: number) => void;
  private readonly sweep: (nowMs: number) => void;
  private readonly clock: () => number;
  private readonly warn: (message: string) => void;

  constructor(
    step: (tick: number, nowMs: number) => void,
    clock: () => number = () => performance.now(),
    warn: (message: string) => void = (message) => console.warn(message),
    sweep: (nowMs: number) => void = () => {},
  ) {
    this.step = step;
    this.clock = clock;
    this.warn = warn;
    this.sweep = sweep;
  }

  get metrics(): TickLoopMetrics {
    const ordered = [...this.samples].sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(ordered.length * 0.95) - 1);
    return {
      tick: this.serverTick,
      aggregateP95Ms: ordered[p95Index] ?? 0,
      overloaded: this.clock() < this.overloadUntilMs,
    };
  }

  get refuseNewRooms(): boolean {
    return this.clock() < this.overloadUntilMs;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.previousMs = this.clock();
    const wake = (): void => {
      this.wake(this.clock());
      this.timer = setTimeout(wake, 2);
    };
    this.timer = setTimeout(wake, 0);
  }

  stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  wake(nowMs: number): number {
    if (!Number.isFinite(nowMs) || nowMs < this.previousMs) {
      throw new RangeError("loop clock must be finite and monotonic");
    }
    this.accumulatorMs += Math.min(250, nowMs - this.previousMs);
    this.previousMs = nowMs;
    let stepped = 0;
    const aggregateStart = this.clock();
    while (this.accumulatorMs >= TICK_MS && stepped < MAX_CATCH_UP) {
      this.serverTick += 1;
      this.runPhase("step", this.serverTick, () => this.step(this.serverTick, nowMs));
      this.runPhase("sweep", this.serverTick, () => this.sweep(nowMs));
      this.accumulatorMs -= TICK_MS;
      stepped += 1;
    }
    if (stepped === MAX_CATCH_UP && this.accumulatorMs >= TICK_MS) {
      this.accumulatorMs = 0;
      this.overloadUntilMs = nowMs + 5_000;
      this.warn("tick overload: debt dropped; refusing new rooms for 5s");
    }
    if (stepped > 0) {
      this.samples.push(Math.max(0, this.clock() - aggregateStart));
      if (this.samples.length > SAMPLE_LIMIT) this.samples.shift();
    }
    return stepped;
  }

  private runPhase(phase: "step" | "sweep", tick: number, action: () => void): void {
    try {
      action();
    } catch (error) {
      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      this.warn(`authoritative loop ${phase} error at tick ${tick}; tick continued\n${detail}`);
    }
  }
}
