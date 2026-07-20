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
  encodeFrame,
  type HelloFrame,
  type WelcomeFrame,
} from "@gungame/protocol";

import { RoomManager, type JoinSuccess, type PlayerPeer } from "../src/rooms.js";

class Peer implements PlayerPeer {
  sendReliable(): void {}
  sendBaseline(): void {}
  sendSnapshot(): void {}
  disconnect(): void {}
}

function joinHello(overrides: Partial<HelloFrame> = {}): HelloFrame {
  const encoded = encodeFrame({
    type: FrameType.Hello,
    protocolVersion: PROTOCOL_VERSION,
    buildHash: "dev",
    joinKind: JoinKind.Quickplay,
    mode: GameMode.GunGame,
    variant: GravityVariant.Standard,
    ladder: Ladder.Classic,
    mapPreference: MapPreference.AutoRotate,
    name: "Hotfix Guest",
    roomId: "",
    reconnectToken: new Uint8Array(),
    ...overrides,
  });
  const decoded = decodeFrame(encoded);
  if (decoded.type !== FrameType.Hello) throw new Error("expected hello round trip");
  return decoded;
}

function joinThroughWire(
  manager: RoomManager,
  hello: HelloFrame,
  nowMs: number,
): { readonly joined: JoinSuccess; readonly welcome: WelcomeFrame } {
  const decodedHello = decodeFrame(encodeFrame(hello));
  if (decodedHello.type !== FrameType.Hello) throw new Error("expected hello frame");
  const joined = manager.join(decodedHello, new Peer(), nowMs);
  if ("refusal" in joined) throw new Error(joined.refusal);
  const welcome = decodeFrame(encodeFrame({
    type: FrameType.Welcome,
    playerId: joined.slot.id,
    roomId: joined.room.id,
    reconnectToken: joined.token,
    maxDatagramSize: 1_100,
    mode: joined.room.config.mode,
    variant: joined.room.config.variant,
    ladder: joined.room.config.ladder,
    mapId: joined.room.mapId,
  }));
  if (welcome.type !== FrameType.Welcome) throw new Error("expected welcome frame");
  return { joined, welcome };
}

describe("hotfix5 room routing integration", () => {
  it("routes quickplay hellos three seconds apart into the same room", () => {
    const manager = new RoomManager(undefined, () => false);
    const first = joinThroughWire(manager, joinHello({ name: "First Human" }), 0);
    for (let tick = 1; tick <= 192; tick += 1) {
      manager.tick(tick, tick * 1_000 / 64);
    }
    const second = joinThroughWire(manager, joinHello({ name: "Second Human" }), 3_000);

    expect(second.welcome.roomId).toBe(first.welcome.roomId);
    expect(first.joined.room.connectedCount).toBe(2);
  });

  it("routes an invite guest into the created ARSENAL room and preserves its ladder", () => {
    const manager = new RoomManager(undefined, () => false);
    const owner = joinThroughWire(manager, joinHello({
      joinKind: JoinKind.Create,
      ladder: Ladder.Arsenal,
      name: "Arsenal Owner",
    }), 0);
    for (let tick = 1; tick <= 192; tick += 1) {
      manager.tick(tick, tick * 1_000 / 64);
    }

    const guest = joinThroughWire(manager, joinHello({
      joinKind: JoinKind.Invite,
      roomId: owner.welcome.roomId,
      name: "Arsenal Guest",
    }), 3_000);

    expect(guest.welcome.roomId).toBe(owner.welcome.roomId);
    expect(guest.welcome.ladder).toBe(Ladder.Arsenal);
  });

  it.each([
    { label: "quickplay", joinKind: JoinKind.Quickplay, roomId: "" },
    { label: "ARSENAL invite", joinKind: JoinKind.Invite, roomId: "created" },
  ])("lets a human displace a fill bot for $label routing", ({ joinKind, roomId }) => {
    const manager = new RoomManager(undefined, () => false);
    const owner = manager.join(joinHello({
      joinKind: JoinKind.Create,
      ladder: Ladder.Arsenal,
      name: "Capacity Owner",
    }), new Peer(), 0);
    if ("refusal" in owner) throw new Error(owner.refusal);

    // Seven reconnect reservations plus the owner and four fill bots occupy
    // all physical slots. A bot must yield rather than split/refuse a human.
    for (let index = 0; index < 7; index += 1) {
      const held = manager.join(joinHello({
        joinKind: JoinKind.Invite,
        roomId: owner.room.id,
        name: `Held Human ${index}`,
      }), new Peer(), index + 1);
      if ("refusal" in held) throw new Error(held.refusal);
      owner.room.disconnect(held.slot.id, index + 1);
    }
    expect(owner.room.players.size).toBe(12);

    const guest = manager.join(joinHello({
      joinKind,
      roomId: roomId === "created" ? owner.room.id : "",
      name: "Routed Human",
    }), new Peer(), 3_000);
    if ("refusal" in guest) throw new Error(guest.refusal);

    expect(guest.room.id).toBe(owner.room.id);
    expect(guest.room.config.ladder).toBe(Ladder.Arsenal);
  });
});
