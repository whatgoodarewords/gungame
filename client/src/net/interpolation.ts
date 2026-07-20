import type { EntityState } from "@gungame/protocol";

export type NetTransport = "datagram" | "ws";

interface BufferedEntity {
  readonly tick: number;
  readonly state: EntityState;
}

export interface InterpolatedEntity extends EntityState {
  readonly sourceTick: number;
}

/** Sim tick duration; extrapolation converts velocity (units/s) to displacement. */
const TICK_SECONDS = 1 / 64;
/**
 * Cap on velocity dead-reckoning while the buffer is starved. Two ticks (~31 ms)
 * hides a single dropped snapshot without letting a runner rubber-band far past
 * where the server will actually place them when the burst clears. Beyond this
 * the remote freezes — a brief pause reads better than a large teleport-back.
 */
const MAX_EXTRAPOLATION_TICKS = 2;

export class RemoteInterpolation {
  private readonly buffers = new Map<number, BufferedEntity[]>();
  private adaptiveDelay: number;
  private readonly baseDelay: number;
  private stalled = false;

  constructor(transport: NetTransport) {
    this.baseDelay = transport === "datagram" ? 3 : 5;
    this.adaptiveDelay = this.baseDelay;
  }

  get delayTicks(): number {
    return this.adaptiveDelay;
  }

  /** Whether the most recent sample() ran past the newest buffered tick. */
  get lastSampleStalled(): boolean {
    return this.stalled;
  }

  push(tick: number, entities: readonly EntityState[], selfId: number): void {
    const seen = new Set<number>();
    for (const state of entities) {
      if (state.id === selfId) continue;
      seen.add(state.id);
      let buffer = this.buffers.get(state.id);
      if (buffer === undefined) {
        buffer = [];
        this.buffers.set(state.id, buffer);
      }
      const previous = buffer[buffer.length - 1];
      if (previous !== undefined && previous.state.generation !== state.generation) {
        buffer.length = 0;
      }
      buffer.push({ tick, state });
      while (buffer.length > 16) buffer.shift();
    }
    // Prune departed entities so leavers never linger as ghost husks
    // (review finding 6). push() receives the session's full entity map,
    // so absence here is authoritative deletion.
    for (const id of this.buffers.keys()) {
      if (!seen.has(id)) this.buffers.delete(id);
    }
  }

  noteStall(stalled: boolean): void {
    if (stalled) this.adaptiveDelay = Math.min(7, this.adaptiveDelay + 1);
    else this.adaptiveDelay = Math.max(this.baseDelay, this.adaptiveDelay - 0.05);
  }

  sample(targetTick: number, fraction: number): readonly InterpolatedEntity[] {
    const exact = targetTick + Math.max(0, Math.min(255, fraction)) / 256;
    const result: InterpolatedEntity[] = [];
    let starved = false;
    for (const buffer of this.buffers.values()) {
      if (buffer.length === 0) continue;
      const newest = buffer[buffer.length - 1]!;
      // Starvation: the interpolation target is ahead of everything buffered
      // (WS burst loss — our primary transport). Dead-reckon by the last known
      // velocity for a bounded window instead of hard-freezing, then freeze.
      if (exact > newest.tick) {
        starved = true;
        const dt = Math.min(exact - newest.tick, MAX_EXTRAPOLATION_TICKS) * TICK_SECONDS;
        result.push({
          ...newest.state,
          position: {
            x: newest.state.position.x + newest.state.velocity.x * dt,
            y: newest.state.position.y + newest.state.velocity.y * dt,
            z: newest.state.position.z + newest.state.velocity.z * dt,
          },
          sourceTick: newest.tick,
        });
        continue;
      }
      let before = buffer[0];
      let after = buffer[buffer.length - 1];
      for (const item of buffer) {
        if (item.tick <= exact) before = item;
        if (item.tick >= exact) {
          after = item;
          break;
        }
      }
      if (before === undefined || after === undefined) continue;
      if (before.state.generation !== after.state.generation) {
        result.push({ ...after.state, sourceTick: after.tick });
        continue;
      }
      const span = Math.max(1, after.tick - before.tick);
      const alpha = Math.max(0, Math.min(1, (exact - before.tick) / span));
      result.push({
        ...after.state,
        position: {
          x: before.state.position.x + (after.state.position.x - before.state.position.x) * alpha,
          y: before.state.position.y + (after.state.position.y - before.state.position.y) * alpha,
          z: before.state.position.z + (after.state.position.z - before.state.position.z) * alpha,
        },
        velocity: {
          x: before.state.velocity.x + (after.state.velocity.x - before.state.velocity.x) * alpha,
          y: before.state.velocity.y + (after.state.velocity.y - before.state.velocity.y) * alpha,
          z: before.state.velocity.z + (after.state.velocity.z - before.state.velocity.z) * alpha,
        },
        viewYaw: before.state.viewYaw + (after.state.viewYaw - before.state.viewYaw) * alpha,
        viewPitch:
          before.state.viewPitch + (after.state.viewPitch - before.state.viewPitch) * alpha,
        sourceTick: before.tick,
      });
    }
    this.stalled = starved;
    return result;
  }
}
