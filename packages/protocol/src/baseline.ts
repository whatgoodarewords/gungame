import { ProtocolError } from "./binary.js";

export type EpochReference = "current" | "valid-stale";

function nextEpoch(epoch: number): number {
  return epoch === 0xffff ? 1 : epoch + 1;
}

export class ServerBaselineEpochs {
  private installedEpoch = 0;
  private readonly pending: Array<{ epoch: number; tick: number }> = [];
  private readonly sent = new Map<number, Set<number>>();

  get epoch(): number {
    return this.pending.at(-1)?.epoch ?? this.installedEpoch;
  }

  get deltasSuspended(): boolean {
    return this.pending.length !== 0;
  }

  openFull(snapshotTick: number): number {
    if (!Number.isInteger(snapshotTick) || snapshotTick < 0) {
      throw new ProtocolError("snapshotTick must be a non-negative integer");
    }
    const epoch = nextEpoch(this.pending.at(-1)?.epoch ?? this.installedEpoch);
    this.pending.push({ epoch, tick: snapshotTick });
    const ticks = this.sent.get(epoch) ?? new Set<number>();
    ticks.add(snapshotTick);
    this.sent.set(epoch, ticks);
    return epoch;
  }

  acknowledge(epoch: number, snapshotTick: number): void {
    if (this.sent.get(epoch)?.has(snapshotTick) !== true) {
      throw new ProtocolError("baseline ack references a value never sent");
    }
    const index = this.pending.findIndex(
      (candidate) => candidate.epoch === epoch && candidate.tick === snapshotTick,
    );
    // Duplicate and superseded acknowledgements are harmless once the pair is
    // known to have actually been transmitted.
    if (index < 0) return;
    this.installedEpoch = epoch;
    this.pending.splice(0, index + 1);
  }

  classifyReference(epoch: number): EpochReference {
    if (epoch === this.epoch) return "current";
    if (epoch === this.installedEpoch || this.pending.some((candidate) => candidate.epoch === epoch)) {
      return "valid-stale";
    }
    throw new ProtocolError("cross-epoch reference");
  }
}

export class ClientBaselineEpochs {
  private installedEpoch = 0;
  private previousEpoch = 0;
  private resyncOpen = false;

  get epoch(): number {
    return this.installedEpoch;
  }

  installFull(epoch: number): void {
    if (!Number.isInteger(epoch) || epoch < 1 || epoch > 0xffff) {
      throw new ProtocolError("baseline epoch must be uint16 and non-zero");
    }
    if (epoch === this.installedEpoch) return;
    this.previousEpoch = this.installedEpoch;
    this.installedEpoch = epoch;
    this.resyncOpen = this.previousEpoch !== 0;
  }

  finishResync(): void {
    this.previousEpoch = 0;
    this.resyncOpen = false;
  }

  classifyTraffic(epoch: number): EpochReference {
    if (epoch === this.installedEpoch) return "current";
    if (this.resyncOpen && epoch === this.previousEpoch) return "valid-stale";
    throw new ProtocolError("cross-epoch traffic");
  }
}
