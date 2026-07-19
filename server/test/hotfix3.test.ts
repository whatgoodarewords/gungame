import { describe, expect, it } from "vitest";

import {
  FrameType,
  GameMode,
  GravityVariant,
  JoinKind,
  Ladder,
  MapPreference,
  PROTOCOL_VERSION,
  decodeFrame,
  type CmdFrame,
  type HelloFrame,
} from "@gungame/protocol";
import { Buttons } from "@gungame/sim";

import { BOT_NAMES } from "../src/godtier.js";
import { Room, RoomManager, type PlayerPeer } from "../src/rooms.js";

class Peer implements PlayerPeer {
  readonly baselines: Uint8Array[] = [];
  readonly snapshots: Uint8Array[] = [];
  readonly closes: Array<readonly [number, string]> = [];

  sendReliable(): void {}
  sendBaseline(bytes: Uint8Array): void { this.baselines.push(bytes); }
  sendSnapshot(bytes: Uint8Array): void { this.snapshots.push(bytes); }
  disconnect(code: number, reason: string): void { this.closes.push([code, reason]); }
}

class ThrowingSnapshotPeer extends Peer {
  override sendSnapshot(): void {
    throw new Error("synthetic snapshot transport failure");
  }
}

function hello(name: string): HelloFrame {
  return {
    type: FrameType.Hello,
    protocolVersion: PROTOCOL_VERSION,
    buildHash: "dev",
    joinKind: JoinKind.Quickplay,
    mode: GameMode.GunGame,
    variant: GravityVariant.Standard,
    ladder: Ladder.Classic,
    mapPreference: MapPreference.AutoRotate,
    name,
    roomId: "",
    reconnectToken: new Uint8Array(),
  };
}

function room(spawns: readonly { x: number; y: number; z: number }[] = []): Room {
  return new Room("hotfix3", {
    mode: GameMode.GunGame,
    variant: GravityVariant.Standard,
    ladder: Ladder.Classic,
    mapPreference: MapPreference.AutoRotate,
  }, undefined, 0, spawns);
}

function installBaseline(value: Room, slotId: number): void {
  value.openBaseline(slotId, 0);
  const slot = value.players.get(slotId);
  if (slot === undefined) throw new Error("slot missing");
  value.acknowledgeBaseline(slotId, slot.epochs.epoch, 0);
}

function invalidEpochCommand(): CmdFrame {
  return {
    type: FrameType.Cmd,
    seq: 1,
    tick: 1,
    buttons: Buttons.Forward,
    viewYaw: 0,
    viewPitch: 0,
    fireFraction: 0,
    lastSnapshotTick: 0,
    interpTargetTick: 0,
    interpTargetFraction: 0,
    baselineEpoch: 999,
  };
}

describe("hotfix3 room lifecycle regressions", () => {
  it("quarantines only a snapshot-failing slot and continues sending to its peer", () => {
    const value = room();
    const badPeer = new ThrowingSnapshotPeer();
    const goodPeer = new Peer();
    const bad = value.add(badPeer, 0, "Bad Transport")!.slot;
    const good = value.add(goodPeer, 0, "Good Transport")!.slot;
    installBaseline(value, bad.id);
    installBaseline(value, good.id);

    value.tick(1, 100);

    expect(bad.peer).toBeUndefined();
    expect(bad.holdUntilMs).toBe(45_100);
    expect(badPeer.closes[0]?.[0]).toBe(4002);
    expect(good.peer).toBe(goodPeer);
    expect(goodPeer.snapshots).toHaveLength(1);
  });

  it("clears every slot even when one peer throws during room-global disband", () => {
    const value = room();
    value.add({
      sendReliable: () => {},
      sendBaseline: () => {},
      sendSnapshot: () => {},
      disconnect: () => { throw new Error("broken close"); },
    }, 0, "Broken Close");
    value.add(new Peer(), 0, "Other Peer");

    expect(() => value.disbandOnError()).not.toThrow();
    expect(value.players.size).toBe(0);
  });

  it("handles the exact two-hold 45,001 ms boundary with five bots, never six", () => {
    const manager = new RoomManager(undefined, () => false);
    const first = manager.join(hello("First Human"), new Peer(), 0);
    if ("refusal" in first) throw new Error(first.refusal);
    const second = manager.join(hello("Second Human"), new Peer(), 0);
    if ("refusal" in second) throw new Error(second.refusal);
    first.room.disconnect(second.slot.id, 0);
    expect([...first.room.players.values()].filter((slot) => slot.isBot)).toHaveLength(4);

    first.room.disconnect(first.slot.id, 45_001);

    const slots = [...first.room.players.values()];
    expect({
      players: slots.length,
      bots: slots.filter((slot) => slot.isBot).length,
      connected: slots.filter((slot) => !slot.isBot && slot.peer !== undefined).length,
      held: slots.filter((slot) => !slot.isBot && slot.peer === undefined).length,
    }).toEqual({ players: 6, bots: 5, connected: 0, held: 1 });
  });

  it("defers a one-candidate spawn until the occupied capsule clears", () => {
    const value = room([{ x: 0, y: 0, z: 0 }]);
    const first = value.add(new Peer(), 0, "First")!.slot;
    const deferred = value.add(new Peer(), 0, "Deferred")!.slot;
    expect(first.alive).toBe(true);
    expect(deferred.alive).toBe(false);

    first.state = {
      ...first.state,
      player: { ...first.state.player, position: { x: 5, y: 0, z: 0 } },
    };
    value.tick(1, 1);

    expect(deferred.alive).toBe(true);
    expect(deferred.state.player.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("defers when every candidate is capsule-occupied and retries deterministically", () => {
    const value = room([{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }]);
    const first = value.add(new Peer(), 0, "First")!.slot;
    value.add(new Peer(), 0, "Second");
    const deferred = value.add(new Peer(), 0, "Third")!.slot;
    expect(deferred.alive).toBe(false);

    first.state = {
      ...first.state,
      player: { ...first.state.player, position: { x: 8, y: 0, z: 0 } },
    };
    value.tick(1, 1);

    expect(deferred.alive).toBe(true);
    expect(deferred.state.player.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("uses the tick clock and normal disconnect bookkeeping after forced consume error", () => {
    const manager = new RoomManager(undefined, () => false);
    const joined = manager.join(hello("Protocol Human"), new Peer(), 0);
    if ("refusal" in joined) throw new Error(joined.refusal);
    joined.room.acceptCmd(joined.slot.id, invalidEpochCommand(), 1_234);

    joined.room.tick(1, 1_234);

    const slots = [...joined.room.players.values()];
    expect({
      bots: slots.filter((slot) => slot.isBot).length,
      connected: slots.filter((slot) => !slot.isBot && slot.peer !== undefined).length,
      held: slots.filter((slot) => !slot.isBot && slot.peer === undefined).length,
      emptySince: joined.room.emptySinceMs,
      holdRemainingMs: joined.slot.holdUntilMs - 1_234,
    }).toEqual({
      bots: 5,
      connected: 0,
      held: 1,
      emptySince: 1_234,
      holdRemainingMs: 45_000,
    });
  });

  it("serializes every fill bot with a curated scoreboard name, never pN", () => {
    const manager = new RoomManager(undefined, () => false);
    const joined = manager.join(hello("Score Human"), new Peer(), 0);
    if ("refusal" in joined) throw new Error(joined.refusal);

    const frame = decodeFrame(joined.room.openBaseline(joined.slot.id, 0));
    if (frame.type !== FrameType.Snapshot) throw new Error("expected snapshot");
    const scoreboard = frame.modeState?.scoreboard;
    if (scoreboard === undefined) throw new Error("expected scoreboard");
    const bots = scoreboard.filter((entry) => entry.bot);

    expect(bots).toHaveLength(4);
    expect(bots.every((entry) => BOT_NAMES.some((name) => name === entry.name))).toBe(true);
    expect(bots.some((entry) => typeof entry.name === "string" && /^p\d+$/i.test(entry.name)))
      .toBe(false);
  });
});
