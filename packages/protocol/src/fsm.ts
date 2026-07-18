import { ProtocolError } from "./binary.js";

export type ConnectionState =
  | "connecting"
  | "hello"
  | "baseline-install"
  | "active"
  | "resync"
  | "closing";

export const STATE_TIMEOUT_MS: Readonly<Record<ConnectionState, number>> = Object.freeze({
  connecting: 5_000,
  hello: 5_000,
  "baseline-install": 5_000,
  active: 30_000,
  resync: 5_000,
  closing: 1_000,
});

const LEGAL: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = Object.freeze({
  connecting: ["hello", "closing"],
  hello: ["baseline-install", "closing"],
  "baseline-install": ["active", "resync", "closing"],
  active: ["resync", "closing"],
  resync: ["active", "resync", "closing"],
  closing: [],
});

export class ConnectionFsm {
  private current: ConnectionState = "connecting";
  private enteredAt: number;

  constructor(nowMs = 0) {
    if (!Number.isFinite(nowMs)) throw new ProtocolError("FSM time must be finite");
    this.enteredAt = nowMs;
  }

  get state(): ConnectionState {
    return this.current;
  }

  transition(next: ConnectionState, nowMs: number): void {
    if (!Number.isFinite(nowMs) || nowMs < this.enteredAt) {
      throw new ProtocolError("FSM time must be finite and monotonic");
    }
    if (!LEGAL[this.current].includes(next)) {
      throw new ProtocolError(`illegal transition ${this.current} -> ${next}`);
    }
    this.current = next;
    this.enteredAt = nowMs;
  }

  malformed(nowMs: number): void {
    if (this.current !== "closing") this.transition("closing", nowMs);
  }

  touch(nowMs: number): void {
    if (!Number.isFinite(nowMs) || nowMs < this.enteredAt) {
      throw new ProtocolError("FSM time must be finite and monotonic");
    }
    this.enteredAt = nowMs;
  }

  timedOut(nowMs: number): boolean {
    if (!Number.isFinite(nowMs) || nowMs < this.enteredAt) {
      throw new ProtocolError("FSM time must be finite and monotonic");
    }
    return nowMs - this.enteredAt > STATE_TIMEOUT_MS[this.current];
  }
}
