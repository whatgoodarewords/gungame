import { FrameType, SNAPSHOT_RING_SIZE, SNAPSHOT_SIZE_CEILING } from "./constants.js";
import { ProtocolError } from "./binary.js";
import { encodeFrame } from "./codec.js";
import type { EntityDelta, EntityState, SnapshotEvent, SnapshotFrame } from "./types.js";

function fullEntity(entity: EntityState, selfId: number): EntityDelta {
  return {
    id: entity.id,
    generation: entity.generation,
    create: true,
    ...(entity.id === selfId ? { self: true } : {}),
    position: entity.position,
    velocity: entity.velocity,
    viewYaw: entity.viewYaw,
    viewPitch: entity.viewPitch,
    grounded: entity.grounded,
    alive: entity.alive,
  };
}

function changedVec(
  current: EntityState["position"],
  baseline: EntityState["position"],
): boolean {
  return current.x !== baseline.x || current.y !== baseline.y || current.z !== baseline.z;
}

export function deltaEntities(
  current: readonly EntityState[],
  baseline: readonly EntityState[],
  selfId: number,
): EntityDelta[] {
  const prior = new Map(baseline.map((entity) => [entity.id, entity]));
  const result: EntityDelta[] = [];
  for (const entity of current) {
    const old = prior.get(entity.id);
    prior.delete(entity.id);
    if (old === undefined || old.generation !== entity.generation) {
      result.push(fullEntity(entity, selfId));
      continue;
    }
    const position = changedVec(entity.position, old.position) ? entity.position : undefined;
    const velocity = changedVec(entity.velocity, old.velocity) ? entity.velocity : undefined;
    const angles = entity.viewYaw !== old.viewYaw || entity.viewPitch !== old.viewPitch;
    const status = entity.grounded !== old.grounded || entity.alive !== old.alive;
    if (position !== undefined || velocity !== undefined || angles || status) {
      result.push({
        id: entity.id,
        generation: entity.generation,
        ...(entity.id === selfId ? { self: true } : {}),
        ...(position === undefined ? {} : { position }),
        ...(velocity === undefined ? {} : { velocity }),
        ...(angles ? { viewYaw: entity.viewYaw, viewPitch: entity.viewPitch } : {}),
        ...(status ? { grounded: entity.grounded, alive: entity.alive } : {}),
      });
    }
  }
  for (const deleted of prior.values()) {
    result.push({
      id: deleted.id,
      generation: deleted.generation,
      delete: true,
      ...(deleted.id === selfId ? { self: true } : {}),
    });
  }
  return result.sort((a, b) => Number(b.self === true) - Number(a.self === true) || a.id - b.id);
}

export interface PackSnapshotInput {
  readonly tick: number;
  readonly lastProcessedCmdSeq: number;
  readonly cmdArrivalMargin: number;
  readonly baselineEpoch: number;
  readonly baselineTick: number;
  readonly selfId: number;
  readonly entities: readonly EntityState[];
  readonly baselineEntities: readonly EntityState[];
  readonly events: readonly SnapshotEvent[];
  readonly maxBytes?: number;
  readonly forceFull?: boolean;
}

export interface PackedSnapshot {
  readonly frame: SnapshotFrame;
  readonly bytes: Uint8Array;
  readonly promotedToFull: boolean;
}

export function packSnapshot(input: PackSnapshotInput): PackedSnapshot {
  const ceiling = input.maxBytes ?? SNAPSHOT_SIZE_CEILING;
  if (!Number.isInteger(ceiling) || ceiling < 64 || ceiling > SNAPSHOT_SIZE_CEILING) {
    throw new ProtocolError("invalid snapshot size ceiling");
  }
  const delta: SnapshotFrame = {
    type: FrameType.Snapshot,
    full: false,
    tick: input.tick,
    lastProcessedCmdSeq: input.lastProcessedCmdSeq,
    cmdArrivalMargin: input.cmdArrivalMargin,
    baselineEpoch: input.baselineEpoch,
    baselineTick: input.baselineTick,
    entities: deltaEntities(input.entities, input.baselineEntities, input.selfId),
    events: input.events,
  };
  const deltaBytes = encodeFrame(delta);
  if (input.forceFull !== true && deltaBytes.length <= ceiling) {
    return { frame: delta, bytes: deltaBytes, promotedToFull: false };
  }
  const full: SnapshotFrame = {
    ...delta,
    full: true,
    baselineTick: input.tick,
    entities: input.entities
      .map((entity) => fullEntity(entity, input.selfId))
      .sort((a, b) => Number(b.self === true) - Number(a.self === true) || a.id - b.id),
  };
  const fullBytes = encodeFrame(full);
  if (fullBytes.length > ceiling) {
    throw new ProtocolError(`full snapshot ${fullBytes.length} exceeds ceiling ${ceiling}`);
  }
  return { frame: full, bytes: fullBytes, promotedToFull: true };
}

export class SnapshotRing {
  private readonly values = new Map<number, readonly EntityState[]>();

  set(tick: number, entities: readonly EntityState[]): void {
    this.values.set(tick, entities.map((entity) => ({
      ...entity,
      position: { ...entity.position },
      velocity: { ...entity.velocity },
    })));
    while (this.values.size > SNAPSHOT_RING_SIZE) {
      const oldest = this.values.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }

  get(tick: number): readonly EntityState[] | undefined {
    return this.values.get(tick);
  }

  has(tick: number): boolean {
    return this.values.has(tick);
  }
}

export class EventJournal {
  private readonly events = new Map<number, SnapshotEvent>();
  private readonly seen = new Set<number>();

  add(event: SnapshotEvent): void {
    if (!this.events.has(event.id)) this.events.set(event.id, event);
  }

  pendingAfter(baselineTick: number): readonly SnapshotEvent[] {
    return [...this.events.values()]
      .filter((event) => event.tick > baselineTick)
      .sort((a, b) => a.id - b.id);
  }

  acknowledgeBaseline(tick: number): void {
    for (const [id, event] of this.events) {
      if (event.tick <= tick) this.events.delete(id);
    }
  }

  dedupe(events: readonly SnapshotEvent[]): readonly SnapshotEvent[] {
    const fresh: SnapshotEvent[] = [];
    for (const event of events) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      fresh.push(event);
    }
    return fresh;
  }
}
