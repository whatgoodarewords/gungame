import { describe, expect, it } from "vitest";

import {
  ARSENAL_LADDER,
  LadderId,
  WeaponId,
  WEAPONS,
} from "@gungame/shared";

import {
  CombatMode,
  ModeRules,
  OwnProjectilePrediction,
  ProjectileSystem,
  applyDamage,
  fireDirection,
  resolveHitscan,
  resolveSplash,
  respawnPlayer,
  rewindHull,
  shooterEye,
  validateFireTarget,
  type ProjectileWorld,
} from "../src/index.js";

describe("fire contract and rewind", () => {
  it("clamps forged targets to the estimate and bounds forged fractions", () => {
    const forged = validateFireTarget({
      executionTick: 100,
      requestedTick: 1,
      requestedFraction: 999,
      estimateTick: 94,
      estimateFraction: 128,
      sentSnapshotTicks: [92, 93, 94, 95],
      lastAcceptedExactTick: 93,
    });
    expect(forged).toMatchObject({ tick: 94, fraction: 128, usedEstimate: true });

    const future = validateFireTarget({
      executionTick: 100,
      requestedTick: 95,
      requestedFraction: 255,
      estimateTick: 93,
      estimateFraction: 0,
      sentSnapshotTicks: [92, 93, 94, 95],
      plausibleMaximumTick: 94,
    });
    expect(future.usedEstimate).toBe(true);
    expect(future.tick).toBe(93);
  });

  it("degrades to exactly the 300 ms clamp on chain overflow", () => {
    const result = validateFireTarget({
      executionTick: 100,
      requestedTick: 70,
      requestedFraction: 0,
      estimateTick: 70,
      estimateFraction: 0,
      sentSnapshotTicks: [70],
    });
    expect(result.clampedForMaxRewind).toBe(true);
    expect(result.tick + result.fraction / 256).toBeCloseTo(80.8, 2);
  });

  it("clamps a regressed adaptive interpolation target instead of rejecting fire", () => {
    const result = validateFireTarget({
      executionTick: 110,
      requestedTick: 92,
      requestedFraction: 0,
      estimateTick: 96,
      estimateFraction: 128,
      sentSnapshotTicks: [92, 93, 94, 95, 96],
      lastAcceptedExactTick: 95,
    });
    expect(result).toMatchObject({ tick: 96, fraction: 128, usedEstimate: true });
  });

  it("hits a moving target at its rewound position and uses E-1→E eye lerp", () => {
    expect(shooterEye(
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      128,
    ).x).toBe(2);
    const hits = resolveHitscan({
      weapon: WEAPONS[WeaponId.Rifle],
      commandSequence: 10,
      previousShooterPosition: { x: 0, y: 0, z: 0 },
      currentShooterPosition: { x: 0, y: 0, z: 0 },
      fireFraction: 128,
      yaw: 0,
      pitch: 0,
      targetTick: 10,
      targetFraction: 0,
      scoped: false,
      targets: [{
        id: 2,
        generation: 3,
        history: [
          { tick: 10, generation: 3, alive: true, position: { x: 0, y: 0, z: -10 } },
          { tick: 20, generation: 3, alive: true, position: { x: 5, y: 0, z: -10 } },
        ],
      }],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.targetId).toBe(2);
  });

  it("never interpolates through death or a generation change", () => {
    expect(rewindHull([
      { tick: 10, generation: 1, alive: true, position: { x: 0, y: 0, z: 0 } },
      { tick: 11, generation: 2, alive: true, position: { x: 2, y: 0, z: 0 } },
    ], 10, 128, 2)).toBeUndefined();
    expect(rewindHull([
      { tick: 10, generation: 2, alive: true, position: { x: 0, y: 0, z: 0 } },
      { tick: 11, generation: 2, alive: false, position: { x: 2, y: 0, z: 0 } },
    ], 10, 128, 2)).toBeUndefined();
  });
});

describe("health and projectile lifecycle", () => {
  it("damages, schedules a two-second respawn, and increments generation", () => {
    const damaged = applyDamage({ health: 100, alive: true, generation: 9, respawnTick: 0 }, 125, 20);
    expect(damaged.killed).toBe(true);
    expect(damaged.life.respawnTick).toBe(148);
    expect(respawnPlayer(damaged.life, 147).alive).toBe(false);
    expect(respawnPlayer(damaged.life, 148)).toMatchObject({ alive: true, health: 100, generation: 10 });
  });

  it("spawns, enforces owner cap, impacts targets/world, and expires", () => {
    const system = new ProjectileSystem();
    for (let index = 0; index < WEAPONS[WeaponId.Peacemaker].projectileLiveCap; index += 1) {
      expect(system.spawn(1, 1, index + 1, WeaponId.Peacemaker,
        { x: 0, y: 0.9, z: 0 }, fireDirection(0, 0), 0)).toBeDefined();
    }
    expect(system.spawn(1, 1, 99, WeaponId.Peacemaker,
      { x: 0, y: 0.9, z: 0 }, fireDirection(0, 0), 1)).toBeDefined();
    expect(system.projectiles).toHaveLength(WEAPONS[WeaponId.Peacemaker].projectileLiveCap);
    expect(system.projectiles.some((projectile) => projectile.fireCmdSeq === 1)).toBe(false);
    expect(system.projectiles.some((projectile) => projectile.fireCmdSeq === 99)).toBe(true);

    const targetHit = system.tick(1, undefined, [{
      id: 2, generation: 1, alive: true, ducked: false,
      position: { x: 0, y: 0, z: -0.4 },
    }]);
    expect(targetHit.some((detonation) =>
      detonation.reason === "lifetime" && detonation.projectile.fireCmdSeq === 1)).toBe(true);
    expect(targetHit.some((detonation) => detonation.directTargetId === 2)).toBe(true);

    const impactSystem = new ProjectileSystem();
    impactSystem.spawn(1, 1, 1, WeaponId.Discus,
      { x: 0, y: 1, z: 0 }, fireDirection(0, 0), 0);
    const wall: ProjectileWorld = {
      projectileInKillVolume: () => false,
      sweepProjectile: (_from, to) => ({ point: to, normal: { x: 0, y: 0, z: 1 } }),
    };
    expect(impactSystem.tick(1, wall, [])[0]?.reason).toBe("impact");

    const lifetime = new ProjectileSystem();
    lifetime.spawn(1, 1, 1, WeaponId.Discus,
      { x: 0, y: 1, z: 0 }, fireDirection(0, 0), 0);
    expect(lifetime.tick(WEAPONS[WeaponId.Discus].projectileLifetimeTicks, undefined, [])[0]?.reason)
      .toBe("lifetime");
  });

  it("calculates splash/self scalars and reconciles ownership by owner+cmd seq", () => {
    const weapon = WEAPONS[WeaponId.Peacemaker];
    const effects = resolveSplash(weapon, { x: 0, y: 0.9, z: 0 }, [
      { id: 1, position: { x: 0, y: 0, z: 0 } },
      { id: 2, position: { x: 1.5, y: 0, z: 0 } },
    ], 1);
    expect(effects.find((effect) => effect.targetId === 1)?.damage).toBeLessThan(
      effects.find((effect) => effect.targetId === 2)?.damage ?? 0,
    );
    expect(effects[0]?.impulse.y).toBeGreaterThan(0);

    const system = new ProjectileSystem();
    const local = system.spawn(7, 2, 44, WeaponId.Discus,
      { x: 0, y: 1, z: 0 }, fireDirection(0, 0), 1);
    if (local === undefined) throw new Error("spawn failed");
    const prediction = new OwnProjectilePrediction();
    prediction.add(local);
    const authoritative = { ...local, id: 0x9000, position: { x: 0, y: 1, z: -0.5 } };
    expect(prediction.reconcile([authoritative])).toEqual([authoritative]);
  });
});

describe("mode rules", () => {
  it("advances, melee-demotes, accepts posthumous kills, and wins on final melee", () => {
    const rules = new ModeRules(CombatMode.GunGame, LadderId.Arsenal);
    const attacker = rules.addPlayer(1);
    const victim = rules.addPlayer(2);
    victim.tier = 4;
    const first = rules.recordKill({ attackerId: 1, victimId: 2, melee: false, suicide: false }, 1);
    expect(first.attackerAdvanced).toBe(true);
    expect(attacker.tier).toBe(2);
    rules.recordKill({ attackerId: 1, victimId: 2, melee: true, suicide: false, posthumous: true }, 2);
    expect(victim.tier).toBe(3);
    attacker.tier = ARSENAL_LADDER.length;
    expect(rules.recordKill({ attackerId: 1, victimId: 2, melee: true, suicide: false }, 3).winnerId)
      .toBe(1);
    expect(rules.snapshot.restartTick).toBe(3 + 8 * 64);
  });

  it("does not advance or demote on suicide", () => {
    const rules = new ModeRules(CombatMode.GunGame, LadderId.Classic);
    const player = rules.addPlayer(1);
    player.tier = 3;
    const result = rules.recordKill({ attackerId: 1, victimId: 1, melee: false, suicide: true }, 1);
    expect(result.suicide).toBe(true);
    expect(result.counted).toBe(false);
    expect(player.tier).toBe(3);
  });

  it("does not relabel freeze or departed-attacker kills as suicides", () => {
    const departed = new ModeRules(CombatMode.GunGame, LadderId.Classic);
    departed.addPlayer(1);
    departed.addPlayer(2);
    departed.removePlayer(1);
    expect(departed.recordKill({
      attackerId: 1, victimId: 2, melee: false, suicide: false,
    }, 1)).toMatchObject({ suicide: false, counted: false });

    const frozen = new ModeRules(CombatMode.GunGame, LadderId.Classic);
    const attacker = frozen.addPlayer(1);
    frozen.addPlayer(2);
    attacker.tier = 6;
    frozen.recordKill({ attackerId: 1, victimId: 2, melee: true, suicide: false }, 2);
    expect(frozen.recordKill({
      attackerId: 1, victimId: 2, melee: false, suicide: false,
    }, 3)).toMatchObject({ suicide: false, counted: false });
  });

  it("uses trailing-parity minus one for late joins", () => {
    const rules = new ModeRules(CombatMode.GunGame, LadderId.Classic);
    rules.addPlayer(1).tier = 5;
    rules.addPlayer(2).tier = 3;
    expect(rules.addPlayer(3).tier).toBe(2);
  });

  it("balances TDM teams, scores to 50, and rebalances after leave", () => {
    const rules = new ModeRules(CombatMode.Scoutzknivez);
    rules.addPlayer(1);
    rules.addPlayer(2);
    rules.addPlayer(3);
    rules.addPlayer(4);
    expect([...rules.players.values()].filter((player) => player.team === 1)).toHaveLength(2);
    rules.removePlayer(2);
    expect(Math.abs(
      [...rules.players.values()].filter((player) => player.team === 1).length -
      [...rules.players.values()].filter((player) => player.team === 2).length,
    )).toBeLessThanOrEqual(1);
    const attacker = [...rules.players.values()].find((player) => player.team === 1);
    const victim = [...rules.players.values()].find((player) => player.team === 2);
    if (attacker === undefined || victim === undefined) throw new Error("teams missing");
    for (let score = 0; score < 50; score += 1) {
      rules.recordKill({ attackerId: attacker.id, victimId: victim.id, melee: false, suicide: false }, score);
    }
    expect(rules.snapshot.teamScores[0]).toBe(50);
    expect(rules.snapshot.winnerId).toBe(attacker.id);
  });
});
