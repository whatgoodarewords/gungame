import { ProtocolError } from "./binary.js";

export type EpochReference = "current" | "valid-stale";

function nextEpoch(epoch: number): number {
  return epoch === 0xffff ? 1 : epoch + 1;
}

export class ServerBaselineEpochs {
  private installedEpoch = 0;
  private pendingEpoch = 0;
  private pendingTick = 0;
  private priorEpoch = 0;

  get epoch(): number {
    return this.pendingEpoch || this.installedEpoch;
  }

  get deltasSuspended(): boolean {
    return this.pendingEpoch !== 0;
  }

  openFull(snapshotTick: number): number {
    if (!Number.isInteger(snapshotTick) || snapshotTick < 0) {
      throw new ProtocolError("snapshotTick must be a non-negative integer");
    }
    this.priorEpoch = this.pendingEpoch || this.installedEpoch;
    this.pendingEpoch = nextEpoch(this.pendingEpoch || this.installedEpoch);
    this.pendingTick = snapshotTick;
    return this.pendingEpoch;
  }

  acknowledge(epoch: number, snapshotTick: number): void {
    if (epoch !== this.pendingEpoch || snapshotTick !== this.pendingTick) {
      throw new ProtocolError("baseline ack does not match open epoch");
    }
    this.installedEpoch = epoch;
    this.pendingEpoch = 0;
    this.pendingTick = 0;
    this.priorEpoch = 0;
  }

  classifyReference(epoch: number): EpochReference {
    if (epoch === (this.pendingEpoch || this.installedEpoch)) return "current";
    if (this.pendingEpoch !== 0 && epoch === this.priorEpoch) return "valid-stale";
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
