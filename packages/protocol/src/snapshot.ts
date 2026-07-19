import {
  EntityKind,
  EventKind,
  FrameType,
  SNAPSHOT_RING_SIZE,
  SNAPSHOT_SIZE_CEILING,
} from "./constants.js";
import { ProtocolError } from "./binary.js";
import { encodeFrame, encodeFrameForSizeProbe } from "./codec.js";
import type { EntityDelta, EntityState, SnapshotEvent, SnapshotFrame } from "./types.js";

function fullEntity(entity: EntityState, selfId: number): EntityDelta {
  const common: EntityDelta = {
    id: entity.id,
    generation: entity.generation,
    create: true,
    ...(entity.id === selfId ? { self: true } : {}),
    position: entity.position,
    velocity: entity.velocity,
    kind: entity.kind,
  };
  return entity.kind === 0
    ? {
        ...common,
        viewYaw: entity.viewYaw,
        viewPitch: entity.viewPitch,
        grounded: entity.grounded,
        alive: entity.alive,
        ducked: entity.ducked ?? false,
        health: entity.health,
        weaponTier: entity.weaponTier,
        ammo: entity.ammo,
      }
    : {
        ...common,
        ownerId: entity.ownerId,
        fireCmdSeq: entity.fireCmdSeq,
        weaponId: entity.weaponId,
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
    const status =
      entity.grounded !== old.grounded ||
      entity.alive !== old.alive ||
      (entity.ducked ?? false) !== (old.ducked ?? false);
    const combat =
      entity.kind !== old.kind ||
      entity.health !== old.health ||
      entity.weaponTier !== old.weaponTier ||
      entity.ammo !== old.ammo ||
      entity.ownerId !== old.ownerId ||
      entity.fireCmdSeq !== old.fireCmdSeq ||
      entity.weaponId !== old.weaponId;
    if (position !== undefined || velocity !== undefined || angles || status || combat) {
      result.push({
        id: entity.id,
        generation: entity.generation,
        ...(entity.id === selfId ? { self: true } : {}),
        ...(position === undefined ? {} : { position }),
        ...(velocity === undefined ? {} : { velocity }),
        ...(angles ? { viewYaw: entity.viewYaw, viewPitch: entity.viewPitch } : {}),
        ...(status ? {
          grounded: entity.grounded,
          alive: entity.alive,
          ducked: entity.ducked ?? false,
        } : {}),
        ...(combat ? {
          kind: entity.kind,
          health: entity.health,
          weaponTier: entity.weaponTier,
          ammo: entity.ammo,
          ownerId: entity.ownerId,
          fireCmdSeq: entity.fireCmdSeq,
          weaponId: entity.weaponId,
        } : {}),
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
  readonly modeState?: SnapshotFrame["modeState"];
}

export interface PackedSnapshot {
  readonly frame: SnapshotFrame;
  readonly bytes: Uint8Array;
  readonly promotedToFull: boolean;
  /** Authoritative state represented after applying this packed frame. */
  readonly baselineEntities: readonly EntityState[];
  readonly deferredEntityIds: readonly number[];
  readonly deferredEventIds: readonly number[];
}

type PackCandidate =
  | { readonly type: "entity"; readonly priority: number; readonly entity: EntityDelta }
  | { readonly type: "event"; readonly priority: number; readonly event: SnapshotEvent };

function eventPriority(event: SnapshotEvent): number {
  if (event.kind === EventKind.Kill) return 1;
  if (event.kind === EventKind.HitConfirm || event.kind === EventKind.Airshot) return 2;
  if (event.kind === EventKind.Damage) return 4;
  return 5;
}

function projectilePriority(entity: EntityDelta): number {
  if (entity.delete === true) return 0;
  if (entity.create === true) return 3;
  return 6;
}

function packWithinBudget(
  base: Omit<SnapshotFrame, "entities" | "events">,
  mandatory: readonly EntityDelta[],
  optional: readonly EntityDelta[],
  events: readonly SnapshotEvent[],
  ceiling: number,
): SnapshotFrame | undefined {
  let frame: SnapshotFrame = { ...base, entities: mandatory, events: [] };
  if (encodeFrameForSizeProbe(frame).length > ceiling) return undefined;
  const candidates: PackCandidate[] = [
    ...optional.map((entity) => ({
      type: "entity" as const,
      priority: projectilePriority(entity),
      entity,
    })),
    ...events.map((event) => ({
      type: "event" as const,
      priority: eventPriority(event),
      event,
    })),
  ].sort((left, right) => left.priority - right.priority ||
    (left.type === "entity" ? left.entity.id : left.event.id) -
    (right.type === "entity" ? right.entity.id : right.event.id));

  for (const candidate of candidates) {
    const next: SnapshotFrame = candidate.type === "entity"
      ? { ...frame, entities: [...frame.entities, candidate.entity] }
      : { ...frame, events: [...frame.events, candidate.event] };
    if (encodeFrameForSizeProbe(next).length <= ceiling) frame = next;
  }
  return frame;
}

function representedState(
  baseline: readonly EntityState[],
  current: readonly EntityState[],
  included: readonly EntityDelta[],
  full: boolean,
): readonly EntityState[] {
  const currentById = new Map(current.map((entity) => [entity.id, entity]));
  const represented = new Map(
    (full ? [] : baseline).map((entity) => [entity.id, entity]),
  );
  for (const delta of included) {
    if (delta.delete === true) represented.delete(delta.id);
    else {
      const entity = currentById.get(delta.id);
      if (entity !== undefined) represented.set(delta.id, entity);
    }
  }
  return [...represented.values()].sort((left, right) => left.id - right.id);
}

function packedResult(
  input: PackSnapshotInput,
  frame: SnapshotFrame,
  promotedToFull: boolean,
): PackedSnapshot {
  const bytes = encodeFrame(frame);
  const includedEntityIds = new Set(frame.entities.map((entity) => entity.id));
  const includedEventIds = new Set(frame.events.map((event) => event.id));
  const allDeltas = frame.full
    ? input.entities.map((entity) => fullEntity(entity, input.selfId))
    : deltaEntities(input.entities, input.baselineEntities, input.selfId);
  return {
    frame,
    bytes,
    promotedToFull,
    baselineEntities: representedState(
      input.baselineEntities,
      input.entities,
      frame.entities,
      frame.full,
    ),
    deferredEntityIds: allDeltas
      .filter((entity) => !includedEntityIds.has(entity.id))
      .map((entity) => entity.id),
    deferredEventIds: input.events
      .filter((event) => !includedEventIds.has(event.id))
      .map((event) => event.id),
  };
}

export function packSnapshot(input: PackSnapshotInput): PackedSnapshot {
  const ceiling = input.maxBytes ?? SNAPSHOT_SIZE_CEILING;
  if (!Number.isInteger(ceiling) || ceiling < 64 || ceiling > SNAPSHOT_SIZE_CEILING) {
    throw new ProtocolError("invalid snapshot size ceiling");
  }
  const deltaEntitiesForFrame = deltaEntities(
    input.entities,
    input.baselineEntities,
    input.selfId,
  );
  const playerIds = new Set([
    ...input.entities
      .filter((entity) => entity.kind === EntityKind.Player)
      .map((entity) => entity.id),
    ...input.baselineEntities
      .filter((entity) => entity.kind === EntityKind.Player)
      .map((entity) => entity.id),
  ]);
  const deltaBase: Omit<SnapshotFrame, "entities" | "events"> = {
    type: FrameType.Snapshot,
    full: false,
    tick: input.tick,
    lastProcessedCmdSeq: input.lastProcessedCmdSeq,
    cmdArrivalMargin: input.cmdArrivalMargin,
    baselineEpoch: input.baselineEpoch,
    baselineTick: input.baselineTick,
    ...(input.modeState === undefined ? {} : { modeState: input.modeState }),
  };
  if (input.forceFull !== true) {
    const mandatoryDelta = deltaEntitiesForFrame.filter(
      (entity) => entity.self === true || playerIds.has(entity.id),
    );
    const optionalDelta = deltaEntitiesForFrame.filter(
      (entity) => entity.self !== true && !playerIds.has(entity.id),
    );
    const delta = packWithinBudget(
      deltaBase,
      mandatoryDelta,
      optionalDelta,
      input.events,
      ceiling,
    );
    if (delta !== undefined) return packedResult(input, delta, false);
  }

  const fullEntities = input.entities
    .map((entity) => fullEntity(entity, input.selfId))
    .sort((a, b) => Number(b.self === true) - Number(a.self === true) || a.id - b.id);
  const fullBase: Omit<SnapshotFrame, "entities" | "events"> = {
    ...deltaBase,
    full: true,
    baselineTick: input.tick,
  };
  const full = packWithinBudget(
    fullBase,
    fullEntities.filter((entity) => entity.self === true || playerIds.has(entity.id)),
    fullEntities.filter((entity) => entity.self !== true && !playerIds.has(entity.id)),
    input.events,
    ceiling,
  );
  if (full === undefined) {
    throw new ProtocolError(`mandatory full snapshot exceeds ceiling ${ceiling}`);
  }
  return packedResult(input, full, true);
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
  private readonly deliveries = new Map<number, readonly number[]>();
  private readonly seen = new Set<number>();
  private seenLowWaterMark = 0;
  private seenInitialized = false;

  get dedupeTrackingSize(): number {
    return this.seen.size;
  }

  get dedupeLowWaterMark(): number {
    return this.seenLowWaterMark;
  }

  add(event: SnapshotEvent): void {
    if (!this.events.has(event.id)) this.events.set(event.id, event);
  }

  pendingAfter(_baselineTick: number): readonly SnapshotEvent[] {
    return [...this.events.values()]
      .sort((a, b) => a.id - b.id);
  }

  recordSnapshot(snapshotTick: number, events: readonly SnapshotEvent[]): void {
    this.deliveries.set(snapshotTick, events.map((event) => event.id));
    while (this.deliveries.size > SNAPSHOT_RING_SIZE) {
      const oldest = this.deliveries.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.deliveries.delete(oldest);
    }
  }

  acknowledgeBaseline(tick: number): void {
    for (const id of this.deliveries.get(tick) ?? []) this.events.delete(id);
    for (const deliveredTick of this.deliveries.keys()) {
      if (deliveredTick <= tick) this.deliveries.delete(deliveredTick);
    }
  }

  dedupe(events: readonly SnapshotEvent[]): readonly SnapshotEvent[] {
    const fresh: SnapshotEvent[] = [];
    if (!this.seenInitialized && events.length !== 0) {
      this.seenLowWaterMark = Math.min(...events.map((event) => event.id)) - 1;
      this.seenInitialized = true;
    }
    for (const event of events) {
      if (event.id <= this.seenLowWaterMark || this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      fresh.push(event);
    }
    while (this.seen.delete(this.seenLowWaterMark + 1)) {
      this.seenLowWaterMark += 1;
    }
    return fresh;
  }
}
