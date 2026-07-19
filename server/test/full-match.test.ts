import { describe, expect, it } from "vitest";

import { FrameType, GameMode, GravityVariant, Ladder, MapPreference, type CmdFrame } from "@gungame/protocol";
import { ladderWeapons } from "@gungame/shared";
import { Buttons } from "@gungame/sim";

import { Room, type PlayerPeer, type PlayerSlot } from "../src/rooms.js";

const peer: PlayerPeer = {
  sendReliable: () => {},
  sendBaseline: () => {},
  sendSnapshot: () => {},
  disconnect: () => {},
};

interface Harness {
  readonly room: Room;
  readonly attacker: PlayerSlot;
  readonly victim: PlayerSlot;
  tick: number;
  seq: number;
  victimSeq: number;
}

function harness(mode: 0 | 1, ladder: 0 | 1): Harness {
  const room = new Room("match", {
    mode,
    variant: mode === GameMode.Scoutzknivez ? GravityVariant.Scoutz : GravityVariant.Standard,
    ladder,
    mapPreference: MapPreference.AutoRotate,
  }, undefined, 0);
  const attacker = room.add(peer, 0, "Bot Alpha")!.slot;
  const victim = room.add(peer, 0, "Bot Bravo")!.slot;
  for (const slot of [attacker, victim]) {
    room.openBaseline(slot.id, 0);
    room.acknowledgeBaseline(slot.id, slot.epochs.epoch, 0);
  }
  return { room, attacker, victim, tick: 0, seq: 1, victimSeq: 1 };
}

function aimAndFire(value: Harness, melee: boolean): void {
  const { room, attacker, victim } = value;
  attacker.protectedUntilTick = 0;
  victim.protectedUntilTick = 0;
  attacker.state = { ...attacker.state, player: {
    ...attacker.state.player,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  } };
  victim.state = { ...victim.state, player: {
    ...victim.state.player,
    position: { x: 0, y: 0, z: melee ? -1.2 : -1 },
    velocity: { x: 0, y: 0, z: 0 },
  } };
  victim.health = 1;
  victim.alive = true;
  for (let index = 0; index < 6; index += 1) {
    value.tick += 1;
    room.tick(value.tick, value.tick);
  }
  value.tick = Math.max(value.tick + 1, attacker.nextFireTick);
  const cmd: CmdFrame = {
    type: FrameType.Cmd,
    seq: value.seq,
    tick: value.tick,
    buttons: Buttons.Fire | Buttons.Zoom | (melee ? Buttons.Melee : 0),
    viewYaw: 0,
    viewPitch: 0,
    fireFraction: 128,
    lastSnapshotTick: Math.max(0, value.tick - 1),
    interpTargetTick: Math.max(0, value.tick - 5),
    interpTargetFraction: 0,
    baselineEpoch: attacker.epochs.epoch,
  };
  value.seq += 1;
  room.acceptCmd(victim.id, {
    ...cmd,
    seq: value.victimSeq,
    buttons: 0,
    baselineEpoch: victim.epochs.epoch,
  }, value.tick);
  value.victimSeq += 1;
  room.acceptCmd(attacker.id, cmd, value.tick);
  room.tick(value.tick, value.tick);
  for (let flight = 0; flight < 8 && victim.alive && room.projectiles.projectiles.length > 0; flight += 1) {
    value.tick += 1;
    room.tick(value.tick, value.tick);
  }
  if (victim.alive) {
    throw new Error(`scripted shot missed: tier=${attacker.tier} health=${victim.health} projectiles=${room.projectiles.projectiles.length}`);
  }
}

function respawnVictim(value: Harness): void {
  value.tick = Math.max(value.tick + 1, value.victim.respawnTick);
  value.room.tick(value.tick, value.tick);
  expect(value.victim.alive).toBe(true);
  // Fill the five-tick interpolation/rewind chain entirely with the new
  // generation; the combat contract deliberately refuses to cross respawn.
  for (let index = 0; index < 6; index += 1) {
    value.tick += 1;
    value.room.tick(value.tick, value.tick);
  }
}

describe("scripted full-match completion", () => {
  for (const ladder of [Ladder.Classic, Ladder.Arsenal] as const) {
    it(`completes and restarts a ${ladder === Ladder.Classic ? "CLASSIC" : "ARSENAL"} gun-game round`, () => {
      const value = harness(GameMode.GunGame, ladder);
      const tiers = ladderWeapons(ladder);
      for (let tier = 1; tier <= tiers.length; tier += 1) {
        expect(value.attacker.tier).toBe(tier);
        aimAndFire(value, tier === tiers.length);
        if (tier < tiers.length) respawnVictim(value);
      }
      expect(value.room.rules.snapshot.winnerId).toBe(value.attacker.id);
      const restartTick = value.room.rules.snapshot.restartTick;
      expect(restartTick).toBeGreaterThan(value.tick);
      value.tick = restartTick;
      value.room.tick(value.tick, value.tick);
      expect(value.room.rules.snapshot.winnerId).toBe(0);
      expect(value.attacker.tier).toBe(1);
      expect(value.attacker.alive).toBe(true);
    });
  }

  it("completes Scoutzknivez TDM to 50 and restarts after the freeze", () => {
    const value = harness(GameMode.Scoutzknivez, Ladder.Classic);
    for (let score = 1; score <= 50; score += 1) {
      aimAndFire(value, false);
      if (score < 50) respawnVictim(value);
    }
    expect(value.room.rules.snapshot.teamScores).toEqual([50, 0]);
    expect(value.room.rules.snapshot.winnerId).toBe(value.attacker.id);
    value.tick = value.room.rules.snapshot.restartTick;
    value.room.tick(value.tick, value.tick);
    expect(value.room.rules.snapshot.teamScores).toEqual([0, 0]);
    expect(value.room.rules.snapshot.winnerId).toBe(0);
  });
});
