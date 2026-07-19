import { CMD_WINDOW_SIZE } from "./constants.js";
import { ProtocolError } from "./binary.js";
import type { CmdFrame } from "./types.js";

export interface ConsumedCmd {
  readonly cmd: CmdFrame;
  readonly epochReference: "current" | "valid-stale";
}

export class CmdAcceptanceWindow {
  private readonly accepted = new Map<number, CmdFrame>();
  private processed = 0;
  private lastConsumedSnapshotTick = 0;

  get lastProcessedCmdSeq(): number {
    return this.processed;
  }

  get size(): number {
    return this.accepted.size;
  }

  accept(cmd: CmdFrame): boolean {
    if (cmd.seq <= this.processed || this.accepted.has(cmd.seq)) return false;
    this.accepted.set(cmd.seq, cmd);
    if (this.accepted.size > CMD_WINDOW_SIZE) {
      const oldest = this.sortedSeqs()[0];
      if (oldest !== undefined) {
        this.accepted.delete(oldest);
        this.processed = Math.max(this.processed, oldest);
      }
    }
    return true;
  }

  consume(
    classifyEpoch: (epoch: number) => "current" | "valid-stale",
  ): ConsumedCmd | undefined {
    // A burst delivered after transport recovery must not turn into permanent
    // input latency. Keep only the two-tick jitter target and advance the ack
    // across every deliberately shed command.
    while (this.accepted.size > 2) {
      const stale = this.sortedSeqs()[0];
      if (stale === undefined) break;
      this.accepted.delete(stale);
      this.processed = Math.max(this.processed, stale);
    }
    const seq = this.sortedSeqs()[0];
    if (seq === undefined) return undefined;
    const cmd = this.accepted.get(seq);
    if (cmd === undefined) return undefined;
    this.accepted.delete(seq);
    this.processed = Math.max(this.processed, seq);
    const epochReference = classifyEpoch(cmd.baselineEpoch);
    if (epochReference === "current") {
      if (cmd.lastSnapshotTick < this.lastConsumedSnapshotTick) {
        throw new ProtocolError("lastSnapshotTick is non-monotonic");
      }
      this.lastConsumedSnapshotTick = cmd.lastSnapshotTick;
    }
    return { cmd, epochReference };
  }

  private sortedSeqs(): number[] {
    return [...this.accepted.keys()].sort((a, b) => a - b);
  }
}
