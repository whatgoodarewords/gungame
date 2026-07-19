import { describe, expect, it } from "vitest";

import {
  EntityKind,
  EventJournal,
  FrameType,
  SNAPSHOT_SIZE_CEILING,
  decodeFrame,
  packSnapshot,
  type EntityState,
} from "../src/index.js";

function players(tick: number, idOffset = 0): readonly EntityState[] {
  return Array.from({ length: 12 }, (_, index) => ({
    id: idOffset + index + 1,
    generation: 1,
    position: { x: index + tick * 0.01, y: 2, z: -index },
    velocity: { x: 1, y: 0, z: 0 },
    viewYaw: index * 10,
    viewPitch: 0,
    grounded: true,
    alive: true,
    kind: EntityKind.Player,
    health: 100,
    weaponTier: 1,
    ammo: 0,
    ownerId: 0,
    fireCmdSeq: 0,
    weaponId: 0,
  }));
}

function projectiles(tick: number): readonly EntityState[] {
  return Array.from({ length: 48 }, (_, index) => ({
    id: 0x8000 + index,
    generation: 1,
    position: { x: index, y: 1, z: -tick - index },
    velocity: { x: 0, y: 0, z: -25 },
    viewYaw: 0,
    viewPitch: 0,
    grounded: false,
    alive: true,
    kind: EntityKind.Projectile,
    health: 0,
    weaponTier: 0,
    ammo: 0,
    ownerId: index % 12 + 1,
    fireCmdSeq: tick * 100 + index,
    weaponId: index % 2 === 0 ? 9 : 10,
  }));
}

function events(tick: number) {
  return Array.from({ length: 64 }, (_, index) => ({
    id: tick * 100 + index + 1,
    tick,
    kind: index % 4 + 1,
    actorId: index % 12 + 1,
    targetId: (index + 1) % 12 + 1,
    amount: 10 + index,
    weaponId: index % 14 + 1,
    flags: index % 2,
  }));
}

describe("snapshot serializer", () => {
  it("fits 12 players under the portable ceiling with mandatory self first", () => {
    const packed = packSnapshot({
      tick: 1,
      lastProcessedCmdSeq: 1,
      cmdArrivalMargin: 2,
      baselineEpoch: 1,
      baselineTick: 0,
      selfId: 7,
      entities: players(1),
      baselineEntities: [],
      events: [],
    });
    expect(packed.bytes.length).toBeLessThanOrEqual(SNAPSHOT_SIZE_CEILING);
    expect(packed.frame.entities[0]?.id).toBe(7);
    expect(packed.frame.entities[0]?.self).toBe(true);
    const decoded = decodeFrame(packed.bytes);
    expect(decoded.type).toBe(FrameType.Snapshot);
  });

  it("promotes an oversized delta to a full snapshot rather than truncating", () => {
    const packed = packSnapshot({
      tick: 2,
      lastProcessedCmdSeq: 2,
      cmdArrivalMargin: 1,
      baselineEpoch: 2,
      baselineTick: 1,
      selfId: 1,
      entities: players(2),
      baselineEntities: players(1, 100),
      events: [],
      maxBytes: 500,
    });
    expect(packed.promotedToFull).toBe(true);
    expect(packed.frame.full).toBe(true);
    expect(packed.frame.entities).toHaveLength(12);
    expect(packed.bytes.length).toBeLessThanOrEqual(500);
  });

  it("keeps the 12-player fixture mean below 400 bytes", () => {
    const sizes: number[] = [];
    let baseline = players(0);
    for (let tick = 1; tick <= 128; tick += 1) {
      const current = players(tick);
      sizes.push(packSnapshot({
        tick,
        lastProcessedCmdSeq: tick,
        cmdArrivalMargin: 2,
        baselineEpoch: 1,
        baselineTick: tick - 1,
        selfId: 1,
        entities: current,
        baselineEntities: baseline,
        events: [],
      }).bytes.length);
      baseline = current;
    }
    const mean = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
    expect(mean).toBeLessThanOrEqual(400);
  });

  it("repeats events until ack coverage and dedupes on the client", () => {
    const server = new EventJournal();
    const client = new EventJournal();
    const event = {
      id: 1, tick: 4, kind: 2, actorId: 1, targetId: 2, amount: 50,
      weaponId: 3, flags: 0,
    };
    server.add(event);
    expect(server.pendingAfter(3)).toEqual([event]);
    expect(client.dedupe(server.pendingAfter(3))).toEqual([event]);
    expect(client.dedupe(server.pendingAfter(3))).toEqual([]);
    server.recordSnapshot(4, [event]);
    server.acknowledgeBaseline(4);
    expect(server.pendingAfter(0)).toEqual([]);
  });

  it("budget-packs a saturated join and defers optional state without probing throws", () => {
    const allEntities = [...players(1), ...projectiles(1)];
    const allEvents = events(1);
    const first = packSnapshot({
      tick: 1,
      lastProcessedCmdSeq: 0,
      cmdArrivalMargin: 0,
      baselineEpoch: 1,
      baselineTick: 1,
      selfId: 1,
      entities: allEntities,
      baselineEntities: [],
      events: allEvents,
      forceFull: true,
    });
    expect(first.bytes.length).toBeLessThanOrEqual(SNAPSHOT_SIZE_CEILING);
    expect(first.frame.entities.filter((entity) =>
      entity.kind === EntityKind.Player)).toHaveLength(12);
    expect(first.deferredEntityIds.length + first.deferredEventIds.length).toBeGreaterThan(0);
    expect(() => decodeFrame(first.bytes)).not.toThrow();

    const deferredEvents = allEvents.filter((event) =>
      first.deferredEventIds.includes(event.id));
    const second = packSnapshot({
      tick: 2,
      lastProcessedCmdSeq: 0,
      cmdArrivalMargin: 0,
      baselineEpoch: 1,
      baselineTick: 1,
      selfId: 1,
      entities: allEntities,
      baselineEntities: first.baselineEntities,
      events: deferredEvents,
    });
    expect(second.bytes.length).toBeLessThanOrEqual(SNAPSHOT_SIZE_CEILING);
    expect(second.frame.entities.some((entity) =>
      first.deferredEntityIds.includes(entity.id))).toBe(true);
  });

  it("prunes monotonic client event ids at the low-water mark", () => {
    const journal = new EventJournal();
    for (let start = 1; start <= 10_000; start += 100) {
      journal.dedupe(Array.from({ length: 100 }, (_, offset) => ({
        id: start + offset,
        tick: start + offset,
        kind: 1,
        actorId: 1,
        targetId: 2,
        amount: 1,
        weaponId: 1,
        flags: 0,
      })));
    }
    expect(journal.dedupeLowWaterMark).toBe(10_000);
    expect(journal.dedupeTrackingSize).toBe(0);
  });

  it("round-trips projectile ownership, player combat state, events, and compact mode state", () => {
    const projectile: EntityState = {
      id: 0x8000,
      generation: 1,
      kind: EntityKind.Projectile,
      position: { x: 1, y: 2, z: 3 },
      velocity: { x: 0, y: 0, z: -25 },
      viewYaw: 0,
      viewPitch: 0,
      grounded: false,
      alive: true,
      health: 0,
      weaponTier: 0,
      ammo: 0,
      ownerId: 7,
      fireCmdSeq: 444,
      weaponId: 9,
    };
    const packed = packSnapshot({
      tick: 50,
      lastProcessedCmdSeq: 444,
      cmdArrivalMargin: 1,
      baselineEpoch: 2,
      baselineTick: 50,
      selfId: 7,
      entities: [players(50)[0]!, projectile],
      baselineEntities: [],
      events: [{
        id: 9, tick: 50, kind: 4, actorId: 7, targetId: 2, amount: 100,
        weaponId: 10, flags: 0b1_1001,
      }],
      modeState: {
        mode: 0,
        ladder: 1,
        mapId: 2,
        roundState: 1,
        winnerId: 7,
        restartTicksRemaining: 511,
        teamScores: [0, 0],
        scoreboard: [{ playerId: 7, kills: 8, deaths: 2, team: 0, tier: 8 }],
      },
      forceFull: true,
    });
    const decoded = decodeFrame(packed.bytes);
    expect(decoded.type).toBe(FrameType.Snapshot);
    if (decoded.type !== FrameType.Snapshot) throw new Error("wrong frame");
    expect(decoded.entities.find((entity) => entity.id === projectile.id)).toMatchObject({
      kind: EntityKind.Projectile,
      ownerId: 7,
      fireCmdSeq: 444,
      weaponId: 9,
    });
    expect(decoded.modeState?.scoreboard[0]).toMatchObject({ playerId: 7, tier: 8 });
    expect(decoded.events[0]).toMatchObject({ kind: 4, weaponId: 10, flags: 0b1_1001 });
  });
});
