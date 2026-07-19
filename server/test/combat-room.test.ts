import { describe, expect, it } from "vitest";

import {
  FrameType,
  EventKind,
  GameMode,
  GravityVariant,
  Ladder,
  MapPreference,
  type CmdFrame,
} from "@gungame/protocol";
import { MapSecretKind, TICK_DT } from "@gungame/shared";
import { Buttons } from "@gungame/sim";

import { Room, RoomManager, validatePlayerName, type PlayerPeer } from "../src/rooms.js";

class Peer implements PlayerPeer {
  reliable: Uint8Array[] = [];
  snapshots: Uint8Array[] = [];
  closes: Array<[number, string]> = [];
  sendReliable(bytes: Uint8Array): void { this.reliable.push(bytes); }
  sendBaseline(bytes: Uint8Array): void { this.reliable.push(bytes); }
  sendSnapshot(bytes: Uint8Array): void { this.snapshots.push(bytes); }
  disconnect(code: number, reason: string): void { this.closes.push([code, reason]); }
}

function command(
  seq: number,
  baselineEpoch: number,
  overrides: Partial<CmdFrame> = {},
): CmdFrame {
  return {
    type: FrameType.Cmd,
    seq,
    tick: seq,
    buttons: Buttons.Fire | Buttons.Zoom,
    viewYaw: 0,
    viewPitch: 0,
    fireFraction: 128,
    lastSnapshotTick: Math.max(0, seq - 1),
    interpTargetTick: Math.max(0, seq - 5),
    interpTargetFraction: 0,
    baselineEpoch,
    ...overrides,
  };
}

function room(ladder: typeof Ladder[keyof typeof Ladder] = Ladder.Classic): Room {
  return new Room("test", {
    mode: GameMode.GunGame,
    variant: GravityVariant.Standard,
    ladder,
    mapPreference: MapPreference.AutoRotate,
  }, undefined, 0);
}

function install(roomValue: Room, slotId: number): number {
  roomValue.openBaseline(slotId, 0);
  const slot = roomValue.players.get(slotId);
  if (slot === undefined) throw new Error("slot missing");
  roomValue.acknowledgeBaseline(slotId, slot.epochs.epoch, 0);
  return slot.epochs.epoch;
}

describe("combat room", () => {
  it("kills through the fire contract, advances the ladder, then respawns with a new generation", () => {
    const value = room();
    const shooter = value.add(new Peer(), 0, "Shooter")!.slot;
    const target = value.add(new Peer(), 0, "Target")!.slot;
    shooter.state = {
      ...shooter.state,
      player: { ...shooter.state.player, position: { x: 0, y: 0, z: 0 } },
    };
    target.state = {
      ...target.state,
      player: { ...target.state.player, position: { x: 0, y: 0, z: -5 } },
    };
    shooter.tier = 5;
    value.rules.players.get(shooter.id)!.tier = 5;
    const epoch = install(value, shooter.id);
    install(value, target.id);
    value.acceptCmd(shooter.id, command(1, epoch), 0);
    value.tick(1, TICK_DT * 1_000);
    expect(target.alive).toBe(false);
    expect(shooter.tier).toBe(6);
    const generation = target.generation;
    for (let tick = 2; tick <= 129; tick += 1) value.tick(tick, tick * TICK_DT * 1_000);
    expect(target.alive).toBe(true);
    expect(target.health).toBe(100);
    expect(target.generation).toBe(generation + 1);
  });

  it("carries knife as secondary and demotes its victim", () => {
    const value = room();
    const shooter = value.add(new Peer(), 0, "Knifer")!.slot;
    const target = value.add(new Peer(), 0, "Victim")!.slot;
    shooter.state = { ...shooter.state, player: {
      ...shooter.state.player, position: { x: 0, y: 0, z: 0 },
    } };
    target.state = { ...target.state, player: {
      ...target.state.player, position: { x: 0, y: 0, z: -1.2 },
    } };
    target.tier = 3;
    value.rules.players.get(target.id)!.tier = 3;
    const epoch = install(value, shooter.id);
    install(value, target.id);
    value.acceptCmd(shooter.id, command(1, epoch, {
      buttons: Buttons.Fire | Buttons.Melee,
    }), 0);
    value.tick(1, TICK_DT * 1_000);
    expect(target.alive).toBe(false);
    expect(target.tier).toBe(2);
    expect(shooter.tier).toBe(2);
  });

  it("lets an in-flight posthumous rocket kill advance", () => {
    const value = room(Ladder.Arsenal);
    const shooter = value.add(new Peer(), 0, "Rocket")!.slot;
    const target = value.add(new Peer(), 0, "Float")!.slot;
    shooter.tier = 4;
    value.rules.players.get(shooter.id)!.tier = 4;
    shooter.state = { ...shooter.state, player: {
      ...shooter.state.player, position: { x: 0, y: 0, z: 0 },
    } };
    target.state = { ...target.state, player: {
      ...target.state.player, position: { x: 0, y: 0, z: -1 },
    } };
    const epoch = install(value, shooter.id);
    install(value, target.id);
    value.acceptCmd(shooter.id, command(1, epoch), 0);
    value.tick(1, TICK_DT * 1_000);
    expect(value.projectiles.projectiles).toHaveLength(1);
    shooter.alive = false;
    shooter.health = 0;
    value.tick(2, 2 * TICK_DT * 1_000);
    expect(target.alive).toBe(false);
    expect(shooter.tier).toBe(5);
  });

  it("kicks input-drought and explicit-background players at 30 seconds", () => {
    const drought = room();
    const firstPeer = new Peer();
    const first = drought.add(firstPeer, 0, "Drought")!.slot;
    drought.tick(1, 30_001);
    expect(drought.players.has(first.id)).toBe(false);
    expect(firstPeer.closes[0]?.[1]).toBe("afk");

    const background = room();
    const secondPeer = new Peer();
    const second = background.add(secondPeer, 0, "Background")!.slot;
    const epoch = install(background, second.id);
    background.acceptCmd(second.id, command(1, epoch, { buttons: Buttons.Background }), 1);
    background.tick(1, 2);
    expect(background.players.has(second.id)).toBe(true);
    background.tick(2, 30_003);
    expect(background.players.has(second.id)).toBe(false);
  });

  it("server-validates a knife ray against the Foundry sigil only once per match", () => {
    const value = new Room("secret", {
      mode: GameMode.GunGame,
      variant: GravityVariant.Standard,
      ladder: Ladder.Classic,
      mapPreference: MapPreference.Foundry,
    }, undefined, 0, [], [{
      kind: MapSecretKind.FoundrySigil,
      bounds: { min: { x: -0.4, y: 1.2, z: -1.5 }, max: { x: 0.4, y: 1.9, z: -1.35 } },
    }]);
    const slot = value.add(new Peer(), 0, "Secret Finder")!.slot;
    slot.state = { ...slot.state, player: {
      ...slot.state.player,
      position: { x: 0, y: 0, z: 0 },
    } };
    const epoch = install(value, slot.id);
    value.acceptCmd(slot.id, command(1, epoch, {
      buttons: Buttons.Fire | Buttons.Melee,
      viewYaw: 0,
      viewPitch: 0,
    }), 0);
    value.tick(1, 1);
    const first = slot.events.pendingAfter(0).filter((event) => event.kind === EventKind.SecretTriggered);
    expect(first).toHaveLength(1);
    value.acceptCmd(slot.id, command(2, epoch, {
      buttons: Buttons.Fire | Buttons.Melee,
      viewYaw: 0,
      viewPitch: 0,
      lastSnapshotTick: 0,
    }), 2_000);
    value.tick(100, 2_000);
    expect(slot.events.pendingAfter(0).filter((event) => event.kind === EventKind.SecretTriggered)).toHaveLength(1);
  });
});

describe("names and reconnect progress", () => {
  it("strips controls then enforces length and the normative charset", () => {
    expect(validatePlayerName("A\u0000B")).toBe("AB");
    expect(validatePlayerName("a")).toBeUndefined();
    expect(validatePlayerName("this-name-is-way-too-long")).toBeUndefined();
    expect(validatePlayerName("bad.name")).toBeUndefined();
    expect(validatePlayerName("Good_Name 7")).toBe("Good_Name 7");
  });

  it("keeps tier on a valid resume and loses it after expiry", () => {
    const manager = new RoomManager(undefined, () => false);
    const hello = {
      type: FrameType.Hello,
      protocolVersion: 3,
      buildHash: "dev",
      joinKind: 0,
      mode: GameMode.GunGame,
      variant: GravityVariant.Standard,
      ladder: Ladder.Classic,
      mapPreference: MapPreference.AutoRotate,
      name: "Resume Me",
      roomId: "",
      reconnectToken: new Uint8Array(),
    } as const;
    const joined = manager.join(hello, new Peer(), 0);
    if ("refusal" in joined) throw new Error(joined.refusal);
    joined.slot.tier = 4;
    joined.room.rules.players.get(joined.slot.id)!.tier = 4;
    joined.room.disconnect(joined.slot.id, 10);
    const resumed = joined.room.resume(joined.token, new Peer(), 45_009);
    expect(resumed?.slot.tier).toBe(4);
    joined.room.disconnect(joined.slot.id, 50_000);
    expect(joined.room.resume(resumed!.token, new Peer(), 95_001)).toBeUndefined();
    const fresh = manager.join({
      ...hello,
      joinKind: 3,
      roomId: joined.room.id,
      reconnectToken: resumed!.token,
    }, new Peer(), 95_002);
    if ("refusal" in fresh) throw new Error(fresh.refusal);
    expect(fresh.slot.id).not.toBe(joined.slot.id);
    expect(fresh.slot.tier).toBe(1);
  });
});

describe("12-bot combat determinism smoke", () => {
  it("produces bit-identical player/projectile outcomes for the same aim/fire script", () => {
    const run = (): unknown => {
      const spawns = Array.from({ length: 12 }, (_, index) => {
        const angle = index / 12 * Math.PI * 2;
        return {
          mode: GameMode.GunGame,
          team: 0,
          position: { x: Math.sin(angle) * 8, y: 0, z: Math.cos(angle) * 8 },
          yaw: angle + Math.PI,
        };
      });
      const value = new Room("bots", {
        mode: GameMode.GunGame,
        variant: GravityVariant.Scoutz,
        ladder: Ladder.Arsenal,
        mapPreference: MapPreference.AutoRotate,
      }, undefined, 0, spawns);
      const epochs = new Map<number, number>();
      for (let index = 0; index < 12; index += 1) {
        const slot = value.add(new Peer(), 0, `Bot_${index + 1}`)!.slot;
        epochs.set(slot.id, install(value, slot.id));
      }
      for (let tick = 1; tick <= 384; tick += 1) {
        const alive = [...value.players.values()].filter((slot) => slot.alive);
        for (const slot of value.players.values()) {
          const target = alive
            .filter((candidate) => candidate.id !== slot.id)
            .sort((left, right) => {
              const ld = Math.hypot(
                left.state.player.position.x - slot.state.player.position.x,
                left.state.player.position.z - slot.state.player.position.z,
              );
              const rd = Math.hypot(
                right.state.player.position.x - slot.state.player.position.x,
                right.state.player.position.z - slot.state.player.position.z,
              );
              return ld - rd || left.id - right.id;
            })[0];
          const dx = (target?.state.player.position.x ?? slot.state.player.position.x) -
            slot.state.player.position.x;
          const dz = (target?.state.player.position.z ?? slot.state.player.position.z - 1) -
            slot.state.player.position.z;
          const yaw = Math.atan2(-dx, -dz) * 180 / Math.PI;
          value.acceptCmd(slot.id, command(tick, epochs.get(slot.id)!, {
            buttons: Buttons.Fire | Buttons.Zoom | Buttons.Forward,
            viewYaw: yaw,
            lastSnapshotTick: tick - 1,
            interpTargetTick: Math.max(0, tick - 5),
            fireFraction: (tick * 37 + slot.id * 11) & 0xff,
          }), tick * TICK_DT * 1_000);
        }
        value.tick(tick, tick * TICK_DT * 1_000);
      }
      return {
        players: [...value.players.values()].map((slot) => ({
          id: slot.id,
          generation: slot.generation,
          health: slot.health,
          alive: slot.alive,
          tier: slot.tier,
          kills: slot.kills,
          deaths: slot.deaths,
          position: slot.state.player.position,
          velocity: slot.state.player.velocity,
        })),
        projectiles: value.projectiles.projectiles,
        mode: value.rules.snapshot,
      };
    };
    const first = run();
    expect(run()).toEqual(first);
  }, 20_000);
});
