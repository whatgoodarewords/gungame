/**
 * Phase 3 weapon tuning.  Combat code consumes this table directly; keeping
 * every behavioural number here makes balance changes data-only.
 */
export const WeaponId = {
  Pistol: 0,
  Smg: 1,
  Shotgun: 2,
  Rifle: 3,
  Scout: 4,
  Knife: 5,
  Sidewinder: 6,
  Boomstick: 7,
  Arc: 8,
  Peacemaker: 9,
  Discus: 10,
  Deadeye: 11,
  Goldie: 12,
} as const;

export type WeaponIdValue = typeof WeaponId[keyof typeof WeaponId];
export type WeaponKind = "hitscan" | "pellet" | "beam" | "projectile" | "melee";

export interface WeaponDefinition {
  readonly id: WeaponIdValue;
  readonly key: string;
  readonly displayName: string;
  readonly kind: WeaponKind;
  readonly damage: number;
  readonly headMultiplier: number;
  readonly headBonus: number;
  readonly pellets: number;
  readonly spreadDegrees: number;
  readonly scopedSpreadDegrees: number;
  readonly refireTicks: number;
  readonly range: number;
  readonly meleeConeCos: number;
  readonly moveSpeedScale: number;
  readonly scopedMoveSpeedScale: number;
  readonly magazine: number;
  readonly reloadTicks: number;
  readonly projectileSpeed: number;
  readonly projectileGravity: number;
  readonly projectileRadius: number;
  readonly projectileLifetimeTicks: number;
  readonly projectileLiveCap: number;
  readonly splashRadius: number;
  readonly splashDamage: number;
  readonly splashFalloffExponent: number;
  readonly knockback: number;
  readonly selfDamageScalar: number;
  readonly directHitBonus: number;
  readonly directHitRadius: number;
}

const ticks = (seconds: number): number => Math.ceil(seconds * 64);

function weapon(
  value: Pick<WeaponDefinition, "id" | "key" | "displayName" | "kind" | "damage"> &
    Partial<Omit<WeaponDefinition, "id" | "key" | "displayName" | "kind" | "damage">>,
): WeaponDefinition {
  return Object.freeze({
    headMultiplier: 1,
    headBonus: 0,
    pellets: 1,
    spreadDegrees: 0,
    scopedSpreadDegrees: 0,
    refireTicks: ticks(0.25),
    range: 100,
    meleeConeCos: Math.cos((38 * Math.PI) / 180),
    moveSpeedScale: 1,
    scopedMoveSpeedScale: 0.72,
    magazine: 0,
    reloadTicks: 0,
    projectileSpeed: 0,
    projectileGravity: 0,
    projectileRadius: 0,
    projectileLifetimeTicks: 0,
    projectileLiveCap: 0,
    splashRadius: 0,
    splashDamage: 0,
    splashFalloffExponent: 1,
    knockback: 0,
    selfDamageScalar: 0,
    directHitBonus: 0,
    directHitRadius: 0,
    ...value,
  });
}

export const WEAPONS: Readonly<Record<WeaponIdValue, WeaponDefinition>> = Object.freeze({
  [WeaponId.Pistol]: weapon({
    id: WeaponId.Pistol, key: "pistol", displayName: "Pistol", kind: "hitscan",
    damage: 34, headMultiplier: 1.75, spreadDegrees: 0.35, refireTicks: ticks(0.24),
  }),
  [WeaponId.Smg]: weapon({
    id: WeaponId.Smg, key: "smg", displayName: "SMG", kind: "hitscan",
    damage: 20, headMultiplier: 1.5, spreadDegrees: 1.25, refireTicks: ticks(0.085),
  }),
  [WeaponId.Shotgun]: weapon({
    id: WeaponId.Shotgun, key: "shotgun", displayName: "Shotgun", kind: "pellet",
    damage: 14, pellets: 8, spreadDegrees: 5.5, refireTicks: ticks(0.82), range: 45,
  }),
  [WeaponId.Rifle]: weapon({
    id: WeaponId.Rifle, key: "rifle", displayName: "Rifle", kind: "hitscan",
    damage: 28, headMultiplier: 2, spreadDegrees: 0.18, refireTicks: ticks(0.11),
  }),
  [WeaponId.Scout]: weapon({
    id: WeaponId.Scout, key: "scout", displayName: "Scout", kind: "hitscan",
    damage: 110, headMultiplier: 1, spreadDegrees: 2.8, scopedSpreadDegrees: 0.03,
    refireTicks: ticks(1.18), scopedMoveSpeedScale: 0.92,
  }),
  [WeaponId.Knife]: weapon({
    id: WeaponId.Knife, key: "knife", displayName: "Knife", kind: "melee",
    damage: 125, range: 1.6, refireTicks: ticks(0.62), moveSpeedScale: 1.14,
  }),
  [WeaponId.Sidewinder]: weapon({
    id: WeaponId.Sidewinder, key: "sidewinder", displayName: "Sidewinder", kind: "hitscan",
    damage: 34, headBonus: 26, spreadDegrees: 0.22, refireTicks: ticks(0.22),
  }),
  [WeaponId.Boomstick]: weapon({
    id: WeaponId.Boomstick, key: "boomstick", displayName: "Boomstick", kind: "pellet",
    damage: 9, pellets: 20, spreadDegrees: 7.2, refireTicks: ticks(1.05), range: 42,
  }),
  [WeaponId.Arc]: weapon({
    id: WeaponId.Arc, key: "arc", displayName: "Arc", kind: "beam",
    damage: 2, headMultiplier: 1, spreadDegrees: 0, refireTicks: 1, range: 32,
  }),
  [WeaponId.Peacemaker]: weapon({
    id: WeaponId.Peacemaker, key: "peacemaker", displayName: "Peacemaker", kind: "projectile",
    damage: 100, refireTicks: ticks(0.78), projectileSpeed: 25, projectileRadius: 0.14,
    projectileLifetimeTicks: ticks(3.2), projectileLiveCap: 4, splashRadius: 3,
    splashDamage: 92, splashFalloffExponent: 1.15, knockback: 11,
    selfDamageScalar: 0.35, directHitRadius: 0.55,
  }),
  [WeaponId.Discus]: weapon({
    id: WeaponId.Discus, key: "discus", displayName: "Discus", kind: "projectile",
    damage: 42, refireTicks: ticks(0.72), projectileSpeed: 40, projectileRadius: 0.11,
    projectileLifetimeTicks: ticks(2.7), projectileLiveCap: 4, splashRadius: 1.55,
    splashDamage: 48, splashFalloffExponent: 1, knockback: 6.5,
    selfDamageScalar: 0.25, directHitBonus: 58, directHitRadius: 0.5,
  }),
  [WeaponId.Deadeye]: weapon({
    id: WeaponId.Deadeye, key: "deadeye", displayName: "Deadeye", kind: "hitscan",
    damage: 55, headMultiplier: 2, spreadDegrees: 3, scopedSpreadDegrees: 0.025,
    refireTicks: ticks(0.92), scopedMoveSpeedScale: 0.92,
  }),
  [WeaponId.Goldie]: weapon({
    id: WeaponId.Goldie, key: "goldie", displayName: "Goldie", kind: "hitscan",
    damage: 125, spreadDegrees: 0.08, refireTicks: ticks(1.2), magazine: 1,
    reloadTicks: ticks(1.2),
  }),
});

export const LadderId = { Classic: 0, Arsenal: 1 } as const;
export type LadderIdValue = typeof LadderId[keyof typeof LadderId];

export const CLASSIC_LADDER = Object.freeze([
  WeaponId.Pistol,
  WeaponId.Smg,
  WeaponId.Shotgun,
  WeaponId.Rifle,
  WeaponId.Scout,
  WeaponId.Knife,
] as const);

export const ARSENAL_LADDER = Object.freeze([
  WeaponId.Sidewinder,
  WeaponId.Boomstick,
  WeaponId.Arc,
  WeaponId.Peacemaker,
  WeaponId.Discus,
  WeaponId.Deadeye,
  WeaponId.Goldie,
  WeaponId.Knife,
] as const);

export const ladderWeapons = (ladder: LadderIdValue): readonly WeaponIdValue[] =>
  ladder === LadderId.Arsenal ? ARSENAL_LADDER : CLASSIC_LADDER;

export const MAX_HEALTH = 100 as const;
export const RESPAWN_TICKS = 2 * 64;
export const SCOREBOARD_FREEZE_TICKS = 8 * 64;
export const SCOUTZ_SCORE_LIMIT = 50 as const;

