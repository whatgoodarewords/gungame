import type { EntityState } from "@gungame/protocol";

export type NetTransport = "datagram" | "ws";

interface BufferedEntity {
  readonly tick: number;
  readonly state: EntityState;
}

export interface InterpolatedEntity extends EntityState {
  readonly sourceTick: number;
}

export class RemoteInterpolation {
  private readonly buffers = new Map<number, BufferedEntity[]>();
  private adaptiveDelay: number;
  private readonly baseDelay: number;

  constructor(transport: NetTransport) {
    this.baseDelay = transport === "datagram" ? 3 : 5;
    this.adaptiveDelay = this.baseDelay;
  }

  get delayTicks(): number {
    return this.adaptiveDelay;
  }

  push(tick: number, entities: readonly EntityState[], selfId: number): void {
    for (const state of entities) {
      if (state.id === selfId) continue;
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
  }

  noteStall(stalled: boolean): void {
    if (stalled) this.adaptiveDelay = Math.min(7, this.adaptiveDelay + 1);
    else this.adaptiveDelay = Math.max(this.baseDelay, this.adaptiveDelay - 0.05);
  }

  sample(targetTick: number, fraction: number): readonly InterpolatedEntity[] {
    const exact = targetTick + Math.max(0, Math.min(255, fraction)) / 256;
    const result: InterpolatedEntity[] = [];
    for (const buffer of this.buffers.values()) {
      if (buffer.length === 0) continue;
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
    return result;
  }
}
