import { describe, expect, it } from "vitest";

import {
  FrameType,
  GameMode,
  GravityVariant,
  JoinKind,
  Ladder,
  MapId,
  MapPreference,
  PROTOCOL_VERSION,
  type HelloFrame,
} from "@gungame/protocol";

import { AuthoritativeLoop } from "../src/loop.js";
import { FixedRing } from "../src/ring.js";
import {
  RoomManager,
  type PlayerPeer,
} from "../src/rooms.js";

class FakePeer implements PlayerPeer {
  readonly reliable: Uint8Array[] = [];
  readonly snapshots: Uint8Array[] = [];
  readonly closes: Array<readonly [number, string]> = [];

  sendReliable(bytes: Uint8Array): void {
    this.reliable.push(bytes);
  }

  sendBaseline(bytes: Uint8Array): void {
    this.reliable.push(bytes);
  }

  sendSnapshot(bytes: Uint8Array): void {
    this.snapshots.push(bytes);
  }

  disconnect(code: number, reason: string): void {
    this.closes.push([code, reason]);
  }
}

function hello(overrides: Partial<HelloFrame> = {}): HelloFrame {
  return {
    type: FrameType.Hello,
    protocolVersion: PROTOCOL_VERSION,
    buildHash: "dev",
    joinKind: JoinKind.Quickplay,
    mode: GameMode.GunGame,
    variant: GravityVariant.Standard,
    ladder: Ladder.Classic,
    mapPreference: MapPreference.AutoRotate,
    name: "Test Player",
    roomId: "",
    reconnectToken: new Uint8Array(),
    ...overrides,
  };
}

describe("authoritative loop", () => {
  it("caps catch-up at four, drops debt, and gates room admission", () => {
    const ticks: number[] = [];
    const warnings: string[] = [];
    let clock = 0;
    const loop = new AuthoritativeLoop(
      (tick) => ticks.push(tick),
      () => clock,
      (message) => warnings.push(message),
    );
    clock = 100;
    expect(loop.wake(clock)).toBe(4);
    expect(ticks).toEqual([1, 2, 3, 4]);
    expect(warnings).toHaveLength(1);
    expect(loop.refuseNewRooms).toBe(true);
    clock = 5_101;
    expect(loop.refuseNewRooms).toBe(false);
  });

  it("stores only the configured ring capacity", () => {
    const ring = new FixedRing<number>(3);
    ring.push(1);
    ring.push(2);
    ring.push(3);
    ring.push(4);
    expect(ring.toArray()).toEqual([2, 3, 4]);
  });
});

describe("rooms and reconnect slots", () => {
  it("selects Spire for Scoutzknivez and Foundry for Gun Game", () => {
    const manager = new RoomManager({
      scoutzknivez: {
        mapId: MapId.Spire,
        world: undefined,
        spawns: [{ mode: GameMode.Scoutzknivez, team: 1, position: { x: -31, y: 12, z: 0 }, yaw: 0 }],
        secrets: [],
      },
      gunGame: [{
        mapId: MapId.Foundry,
        world: undefined,
        spawns: [{ mode: GameMode.GunGame, team: 0, position: { x: 17, y: 0, z: 0 }, yaw: 0 }],
        secrets: [],
      }],
    }, () => false);
    const scoutz = manager.join(hello({
      joinKind: JoinKind.Create,
      mode: GameMode.Scoutzknivez,
      variant: GravityVariant.Scoutz,
    }), new FakePeer(), 0);
    if ("refusal" in scoutz) throw new Error(scoutz.refusal);
    expect(scoutz.slot.state.player.position.x).toBe(-31);
    const gunGame = manager.join(hello({ joinKind: JoinKind.Create }), new FakePeer(), 1);
    if ("refusal" in gunGame) throw new Error(gunGame.refusal);
    expect(gunGame.slot.state.player.position.x).toBe(17);
  });

  it("rotates auto Gun Game rooms Foundry → Duna → Cascade and honors a pin", () => {
    const gunBinding = (mapId: typeof MapId[keyof typeof MapId], x: number) => ({
      mapId,
      world: undefined,
      spawns: [{ mode: GameMode.GunGame, team: 0, position: { x, y: 0, z: 0 }, yaw: 0 }],
      secrets: [],
    });
    const manager = new RoomManager({
      scoutzknivez: {
        mapId: MapId.Spire,
        world: undefined,
        spawns: [{ mode: GameMode.Scoutzknivez, team: 1, position: { x: 0, y: 0, z: 0 }, yaw: 0 }],
        secrets: [],
      },
      gunGame: [
        gunBinding(MapId.Foundry, 10),
        gunBinding(MapId.Duna, 20),
        gunBinding(MapId.Cascade, 30),
      ],
    }, () => false);
    const created = manager.join(hello({ joinKind: JoinKind.Create }), new FakePeer(), 0);
    if ("refusal" in created) throw new Error(created.refusal);
    const victim = created.room.add(new FakePeer(), 0, "Rotation Victim")!.slot;
    const finish = (tick: number): void => {
      created.room.rules.players.get(created.slot.id)!.tier = 6;
      created.room.rules.recordKill({
        attackerId: created.slot.id,
        victimId: victim.id,
        melee: true,
        suicide: false,
      }, tick);
      const restartTick = created.room.rules.snapshot.restartTick;
      created.room.tick(restartTick, restartTick);
    };
    expect(created.room.mapId).toBe(MapId.Foundry);
    finish(1);
    expect(created.room.mapId).toBe(MapId.Duna);
    expect(created.slot.state.player.position.x).toBe(20);
    finish(500);
    expect(created.room.mapId).toBe(MapId.Cascade);
    finish(1_000);
    expect(created.room.mapId).toBe(MapId.Foundry);

    const pinned = manager.join(hello({
      joinKind: JoinKind.Create,
      mapPreference: MapPreference.Duna,
    }), new FakePeer(), 2_000);
    if ("refusal" in pinned) throw new Error(pinned.refusal);
    const pinnedVictim = pinned.room.add(new FakePeer(), 2_000, "Pinned Victim")!.slot;
    pinned.room.rules.players.get(pinned.slot.id)!.tier = 6;
    pinned.room.rules.recordKill({
      attackerId: pinned.slot.id,
      victimId: pinnedVictim.id,
      melee: true,
      suicide: false,
    }, 2_001);
    const pinnedRestart = pinned.room.rules.snapshot.restartTick;
    pinned.room.tick(pinnedRestart, pinnedRestart);
    expect(pinned.room.mapId).toBe(MapId.Duna);
  });

  it("quickplay joins the fullest room and config is immutable-by-copy", () => {
    const manager = new RoomManager(undefined, () => false);
    const created = manager.join(
      hello({
        joinKind: JoinKind.Create,
        mode: GameMode.Scoutzknivez,
        variant: GravityVariant.Scoutz,
        ladder: Ladder.Classic,
      }),
      new FakePeer(),
      0,
    );
    if ("refusal" in created) throw new Error(created.refusal);
    const joined = manager.join(hello(), new FakePeer(), 1);
    if ("refusal" in joined) throw new Error(joined.refusal);
    expect(joined.room.id).toBe(created.room.id);
    expect(joined.room.config).toEqual({
      mode: GameMode.Scoutzknivez,
      variant: GravityVariant.Scoutz,
      ladder: Ladder.Classic,
      mapPreference: MapPreference.AutoRotate,
    });
    expect(Object.isFrozen(joined.room.config)).toBe(true);
  });

  it("rotates a single-use resume token and supersedes the old peer", () => {
    const manager = new RoomManager(undefined, () => false);
    const firstPeer = new FakePeer();
    const joined = manager.join(hello(), firstPeer, 0);
    if ("refusal" in joined) throw new Error(joined.refusal);
    const oldToken = joined.token;
    const secondPeer = new FakePeer();
    const resumed = manager.join(
      hello({
        joinKind: JoinKind.Resume,
        roomId: joined.room.id,
        reconnectToken: oldToken,
      }),
      secondPeer,
      1,
    );
    if ("refusal" in resumed) throw new Error(resumed.refusal);
    expect(resumed.resumed).toBe(true);
    expect(resumed.slot.id).toBe(joined.slot.id);
    expect(resumed.token).not.toEqual(oldToken);
    expect(firstPeer.closes[0]?.[1]).toBe("superseded");

    const replay = manager.join(
      hello({
        joinKind: JoinKind.Resume,
        roomId: joined.room.id,
        reconnectToken: oldToken,
      }),
      new FakePeer(),
      2,
    );
    if ("refusal" in replay) throw new Error(replay.refusal);
    expect(replay.resumed).toBe(false);
    expect(replay.slot.id).not.toBe(joined.slot.id);
  });

  it("holds a disconnected slot for 45 seconds then treats the token as fresh join", () => {
    const manager = new RoomManager(undefined, () => false);
    const joined = manager.join(hello(), new FakePeer(), 0);
    if ("refusal" in joined) throw new Error(joined.refusal);
    joined.room.disconnect(joined.slot.id, 10);
    const resumed = joined.room.resume(joined.token, new FakePeer(), 45_009);
    expect(resumed?.resumed).toBe(true);

    joined.room.disconnect(joined.slot.id, 50_000);
    expect(joined.room.resume(resumed?.token ?? new Uint8Array(), new FakePeer(), 95_001))
      .toBeUndefined();
  });

  it("refuses room creation while admission is blocked", () => {
    const manager = new RoomManager(undefined, () => true);
    expect(manager.join(
      hello({ joinKind: JoinKind.Create }),
      new FakePeer(),
      0,
    )).toEqual({ refusal: "room-create-refused" });
  });
});
