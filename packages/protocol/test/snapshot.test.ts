import { describe, expect, it } from "vitest";

import {
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
      maxBytes: 450,
    });
    expect(packed.promotedToFull).toBe(true);
    expect(packed.frame.full).toBe(true);
    expect(packed.frame.entities).toHaveLength(12);
    expect(packed.bytes.length).toBeLessThanOrEqual(450);
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
    const event = { id: 1, tick: 4, kind: 2, actorId: 1, targetId: 2, amount: 50 };
    server.add(event);
    expect(server.pendingAfter(3)).toEqual([event]);
    expect(client.dedupe(server.pendingAfter(3))).toEqual([event]);
    expect(client.dedupe(server.pendingAfter(3))).toEqual([]);
    server.acknowledgeBaseline(4);
    expect(server.pendingAfter(0)).toEqual([]);
  });
});
