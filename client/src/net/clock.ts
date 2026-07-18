import { TICK_DT } from "@gungame/shared";

const TICK_MS = TICK_DT * 1_000;
const STEP_RESYNC_MS = 250;

export class ClockSync {
  private offsetTicks = 0;
  private rttMs = 0;
  private cmdBiasTicks = 1.5;
  private lastPacingMs = 0;
  private stepped = false;

  get roundTripMs(): number {
    return this.rttMs;
  }

  get commandBiasTicks(): number {
    return this.cmdBiasTicks;
  }

  consumeStepResync(): boolean {
    const value = this.stepped;
    this.stepped = false;
    return value;
  }

  observePong(sentMs: number, receivedMs: number): void {
    if (!Number.isFinite(sentMs) || !Number.isFinite(receivedMs) || receivedMs < sentMs) return;
    const sample = receivedMs - sentMs;
    this.rttMs = this.rttMs === 0 ? sample : this.rttMs * 0.8 + sample * 0.2;
  }

  observeServerTick(serverTick: number, receivedMs: number): void {
    if (!Number.isFinite(receivedMs) || !Number.isInteger(serverTick)) return;
    const localTick = receivedMs / TICK_MS;
    const sampleOffset = serverTick + this.rttMs / (2 * TICK_MS) - localTick;
    const errorMs = Math.abs(sampleOffset - this.offsetTicks) * TICK_MS;
    if (errorMs > STEP_RESYNC_MS) {
      this.offsetTicks = sampleOffset;
      this.stepped = true;
    } else {
      this.offsetTicks += (sampleOffset - this.offsetTicks) * 0.1;
    }
  }

  commandTick(localTick: number, arrivalMargin: number, nowMs: number): number {
    if (!Number.isFinite(nowMs)) return Math.max(0, Math.round(localTick));
    if (this.lastPacingMs === 0) this.lastPacingMs = nowMs;
    const elapsedSeconds = Math.max(0, nowMs - this.lastPacingMs) / 1_000;
    this.lastPacingMs = nowMs;
    const targetBias = arrivalMargin < 1 ? 2 : arrivalMargin > 2 ? 1 : this.cmdBiasTicks;
    const maximumSlew = elapsedSeconds;
    this.cmdBiasTicks += Math.max(
      -maximumSlew,
      Math.min(maximumSlew, targetBias - this.cmdBiasTicks),
    );
    return Math.max(0, Math.round(localTick + this.offsetTicks + this.cmdBiasTicks));
  }

  interpolationTarget(receivedMs: number, delayTicks: number): {
    readonly tick: number;
    readonly fraction: number;
  } {
    const exact = receivedMs / TICK_MS + this.offsetTicks - delayTicks;
    const tick = Math.max(0, Math.floor(exact));
    return {
      tick,
      fraction: Math.max(0, Math.min(255, Math.floor((exact - tick) * 256))),
    };
  }
}
