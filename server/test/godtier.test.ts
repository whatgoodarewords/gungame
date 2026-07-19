import { describe, expect, it } from "vitest";

import { WeaponId } from "@gungame/shared";
import {
  FrameType,
  GameMode,
  GravityVariant,
  JoinKind,
  Ladder,
  MapPreference,
  PROTOCOL_VERSION,
} from "@gungame/protocol";

import {
  ImpressiveTracker,
  MatchStatTracker,
  angularDeltaDegrees,
  desiredBotCount,
} from "../src/godtier.js";
import { RoomManager, type PlayerPeer } from "../src/rooms.js";

const peer = (): PlayerPeer => ({
  sendReliable: () => {},
  sendBaseline: () => {},
  sendSnapshot: () => {},
  disconnect: () => {},
});

describe("phase 6.5 deterministic server features", () => {
  it("removes exactly one of five fill bots per connected human", () => {
    expect(Array.from({ length: 8 }, (_, humans) => desiredBotCount(humans)))
      .toEqual([5, 4, 3, 2, 1, 0, 0, 0]);
    const manager = new RoomManager(undefined, () => false);
    const hello = (name: string) => ({
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
    } as const);
    const first = manager.join(hello("Human One"), peer(), 0);
    if ("refusal" in first) throw new Error(first.refusal);
    expect([...first.room.players.values()].filter((slot) => slot.isBot)).toHaveLength(4);
    const second = manager.join(hello("Human Two"), peer(), 1);
    if ("refusal" in second) throw new Error(second.refusal);
    expect([...first.room.players.values()].filter((slot) => slot.isBot)).toHaveLength(3);
    first.room.disconnect(first.slot.id, 2);
    expect([...first.room.players.values()].filter((slot) => slot.isBot)).toHaveLength(4);
  });

  it("computes flat match-end nouns from authoritative observations", () => {
    const stats = new MatchStatTracker();
    stats.observeMovement(31.24, false);
    for (let hop = 0; hop < 3; hop += 1) {
      stats.observeMovement(12 + hop, true);
      stats.observeMovement(12 + hop, false);
    }
    stats.recordShot(true, 31);
    stats.recordShot(false, 90);
    stats.recordAirshot();
    stats.recordKnifeKill();
    expect(stats.snapshot).toEqual({
      airshots: 1,
      topSpeedDeci: 312,
      longestHopChain: 3,
      flicksLanded: 1,
      knifeKills: 1,
      accuracyPercent: 50,
    });
    expect(angularDeltaDegrees(179, -179)).toBe(2);
  });

  it("awards IMPRESSIVE at 2/4/6/8 and silently resets on miss or life", () => {
    const tracker = new ImpressiveTracker();
    const sequence = Array.from({ length: 8 }, () => tracker.recordShot(WeaponId.Scout, true));
    expect(sequence).toEqual([undefined, 2, undefined, 4, undefined, 6, undefined, 8]);
    expect(tracker.recordShot(WeaponId.Scout, false)).toBeUndefined();
    expect(tracker.recordShot(WeaponId.Scout, true)).toBeUndefined();
    expect(tracker.recordShot(WeaponId.Deadeye, true)).toBe(2);
    tracker.resetLife();
    expect(tracker.recordShot(WeaponId.Deadeye, true)).toBeUndefined();
  });
});
