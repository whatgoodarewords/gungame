import {
  MAX_HEALTH,
  NEAR_MISS_DIALS,
  RESPAWN_TICKS,
  TICK_DT,
  WEAPONS,
  type Vec3,
  type WeaponDefinition,
  type WeaponIdValue,
} from "@gungame/shared";

import { CAPSULE_HEIGHT, CAPSULE_RADIUS, DUCKED_CAPSULE_HEIGHT, EYE_HEIGHT } from "./collision.js";

export const MAX_REWIND_TICKS = 0.3 / TICK_DT;

export interface CombatLife {
  readonly health: number;
  readonly alive: boolean;
  readonly generation: number;
  readonly respawnTick: number;
}

export interface DamageResult {
  readonly life: CombatLife;
  readonly applied: number;
  readonly killed: boolean;
}

export function applyDamage(life: CombatLife, amount: number, tick: number): DamageResult {
  if (!life.alive || !Number.isFinite(amount) || amount <= 0) {
    return { life, applied: 0, killed: false };
  }
  const applied = Math.min(life.health, Math.max(0, Math.round(amount)));
  const health = life.health - applied;
  const killed = health <= 0;
  return {
    applied,
    killed,
    life: killed
      ? { ...life, health: 0, alive: false, respawnTick: tick + RESPAWN_TICKS }
      : { ...life, health },
  };
}

export function killPlayer(life: CombatLife, tick: number): DamageResult {
  return applyDamage(life, Math.max(1, life.health), tick);
}

export function respawnPlayer(life: CombatLife, tick: number): CombatLife {
  if (life.alive || tick < life.respawnTick) return life;
  return {
    health: MAX_HEALTH,
    alive: true,
    generation: (life.generation + 1) & 0xffff,
    respawnTick: 0,
  };
}

export interface HullHistorySample {
  readonly tick: number;
  readonly generation: number;
  readonly alive: boolean;
  readonly position: Vec3;
  readonly ducked?: boolean;
  readonly grounded?: boolean;
}

export interface RewoundHull extends HullHistorySample {
  readonly exactTick: number;
}

export interface FireTargetValidation {
  readonly tick: number;
  readonly fraction: number;
  readonly usedEstimate: boolean;
  readonly clampedForMaxRewind: boolean;
}

export interface FireTargetValidationInput {
  readonly executionTick: number;
  readonly requestedTick: number;
  readonly requestedFraction: number;
  readonly estimateTick: number;
  readonly estimateFraction: number;
  readonly sentSnapshotTicks: readonly number[];
  readonly lastAcceptedExactTick?: number;
  /** Send-time/RTT derived bounds. Defaults to the actually-sent range. */
  readonly plausibleMinimumTick?: number;
  readonly plausibleMaximumTick?: number;
}

function validFraction(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

/** Validates the latched target clock and then applies the independent 300 ms clamp. */
export function validateFireTarget(input: FireTargetValidationInput): FireTargetValidation {
  const sent = input.sentSnapshotTicks;
  const minimum = input.plausibleMinimumTick ?? sent[0] ?? input.estimateTick;
  const maximum = input.plausibleMaximumTick ?? sent[sent.length - 1] ?? input.estimateTick;
  const fractionOkay = validFraction(input.requestedFraction);
  const requestedExact = input.requestedTick + (fractionOkay ? input.requestedFraction / 256 : 0);
  const monotonic = input.lastAcceptedExactTick === undefined || requestedExact >= input.lastAcceptedExactTick;
  const actuallySent = sent.includes(input.requestedTick);
  const plausible = requestedExact >= minimum && requestedExact <= maximum + 255 / 256;
  const useEstimate = !fractionOkay || !monotonic || !actuallySent || !plausible;
  let exact = useEstimate
    ? input.estimateTick + Math.max(0, Math.min(255, input.estimateFraction)) / 256
    : requestedExact;
  const oldestAllowed = input.executionTick - MAX_REWIND_TICKS;
  const clampedForMaxRewind = exact < oldestAllowed;
  exact = Math.max(oldestAllowed, Math.min(input.executionTick, exact));
  const tick = Math.floor(exact);
  return {
    tick,
    fraction: Math.max(0, Math.min(255, Math.floor((exact - tick) * 256))),
    usedEstimate: useEstimate,
    clampedForMaxRewind,
  };
}

export function clampFireFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.floor(value)));
}

/** Fractional rewind with an explicit alive+generation fence. */
export function rewindHull(
  history: readonly HullHistorySample[],
  tick: number,
  fraction: number,
  expectedGeneration: number,
): RewoundHull | undefined {
  const exact = tick + clampFireFraction(fraction) / 256;
  let before: HullHistorySample | undefined;
  let after: HullHistorySample | undefined;
  for (const sample of history) {
    if (sample.tick <= exact) before = sample;
    if (sample.tick >= exact) {
      after = sample;
      break;
    }
  }
  before ??= after;
  after ??= before;
  if (
    before === undefined ||
    after === undefined ||
    !before.alive ||
    !after.alive ||
    before.generation !== expectedGeneration ||
    after.generation !== expectedGeneration ||
    before.generation !== after.generation
  ) return undefined;
  const span = Math.max(1, after.tick - before.tick);
  const alpha = Math.max(0, Math.min(1, (exact - before.tick) / span));
  return {
    ...after,
    exactTick: exact,
    position: {
      x: before.position.x + (after.position.x - before.position.x) * alpha,
      y: before.position.y + (after.position.y - before.position.y) * alpha,
      z: before.position.z + (after.position.z - before.position.z) * alpha,
    },
  };
}

export function fireDirection(yawDegrees: number, pitchDegrees: number): Vec3 {
  const yaw = yawDegrees * Math.PI / 180;
  const pitch = Math.max(-89, Math.min(89, pitchDegrees)) * Math.PI / 180;
  const horizontal = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * horizontal,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * horizontal,
  };
}

export function shooterEye(
  previousPosition: Vec3,
  currentPosition: Vec3,
  fireFraction: number,
  ducked = false,
): Vec3 {
  const alpha = clampFireFraction(fireFraction) / 256;
  const eyeHeight = ducked ? 0.76 : EYE_HEIGHT;
  return {
    x: previousPosition.x + (currentPosition.x - previousPosition.x) * alpha,
    y: previousPosition.y + (currentPosition.y - previousPosition.y) * alpha + eyeHeight,
    z: previousPosition.z + (currentPosition.z - previousPosition.z) * alpha,
  };
}

function addScaled(origin: Vec3, direction: Vec3, scale: number): Vec3 {
  return {
    x: origin.x + direction.x * scale,
    y: origin.y + direction.y * scale,
    z: origin.z + direction.z * scale,
  };
}

function raySphere(origin: Vec3, direction: Vec3, center: Vec3, radius: number): number | undefined {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const projection = ox * direction.x + oy * direction.y + oz * direction.z;
  const discriminant = projection * projection - (ox * ox + oy * oy + oz * oz - radius * radius);
  if (discriminant < 0) return undefined;
  const root = Math.sqrt(discriminant);
  const near = -projection - root;
  const far = -projection + root;
  if (near >= 0) return near;
  return far >= 0 ? far : undefined;
}

function rayVerticalCapsule(
  origin: Vec3,
  direction: Vec3,
  feet: Vec3,
  height: number,
): { readonly distance: number; readonly head: boolean } | undefined {
  const bottomY = feet.y + CAPSULE_RADIUS;
  const topY = feet.y + height - CAPSULE_RADIUS;
  const dx = origin.x - feet.x;
  const dz = origin.z - feet.z;
  const a = direction.x * direction.x + direction.z * direction.z;
  const b = 2 * (dx * direction.x + dz * direction.z);
  const c = dx * dx + dz * dz - CAPSULE_RADIUS * CAPSULE_RADIUS;
  const distances: Array<{ distance: number; head: boolean }> = [];
  if (a > 1e-9) {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      for (const distance of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
        const y = origin.y + direction.y * distance;
        if (distance >= 0 && y >= bottomY && y <= topY) distances.push({ distance, head: false });
      }
    }
  }
  const bottom = raySphere(origin, direction, { x: feet.x, y: bottomY, z: feet.z }, CAPSULE_RADIUS);
  if (bottom !== undefined) distances.push({ distance: bottom, head: false });
  const top = raySphere(origin, direction, { x: feet.x, y: topY, z: feet.z }, CAPSULE_RADIUS);
  if (top !== undefined) distances.push({ distance: top, head: true });
  return distances.sort((left, right) => left.distance - right.distance)[0];
}

function hash(seed: number): number {
  let value = seed | 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

function spreadDirection(base: Vec3, degrees: number, seed: number): Vec3 {
  if (degrees <= 0) return base;
  const randomA = hash(seed) / 0xffff_ffff;
  const randomB = hash(seed ^ 0x9e3779b9) / 0xffff_ffff;
  const radius = Math.sqrt(randomA) * Math.tan(degrees * Math.PI / 180);
  const angle = randomB * Math.PI * 2;
  const up = Math.abs(base.y) > 0.98 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const rightLength = Math.hypot(
    up.y * base.z - up.z * base.y,
    up.z * base.x - up.x * base.z,
    up.x * base.y - up.y * base.x,
  );
  const right = {
    x: (up.y * base.z - up.z * base.y) / rightLength,
    y: (up.z * base.x - up.x * base.z) / rightLength,
    z: (up.x * base.y - up.y * base.x) / rightLength,
  };
  const actualUp = {
    x: base.y * right.z - base.z * right.y,
    y: base.z * right.x - base.x * right.z,
    z: base.x * right.y - base.y * right.x,
  };
  const candidate = {
    x: base.x + radius * (right.x * Math.cos(angle) + actualUp.x * Math.sin(angle)),
    y: base.y + radius * (right.y * Math.cos(angle) + actualUp.y * Math.sin(angle)),
    z: base.z + radius * (right.z * Math.cos(angle) + actualUp.z * Math.sin(angle)),
  };
  const length = Math.hypot(candidate.x, candidate.y, candidate.z);
  return { x: candidate.x / length, y: candidate.y / length, z: candidate.z / length };
}

export interface HitscanTarget {
  readonly id: number;
  readonly generation: number;
  readonly history: readonly HullHistorySample[];
}

export interface CombatHit {
  readonly targetId: number;
  readonly distance: number;
  readonly headshot: boolean;
  readonly damage: number;
  readonly point: Vec3;
}

export interface HitscanInput {
  readonly weapon: WeaponDefinition;
  readonly commandSequence: number;
  readonly previousShooterPosition: Vec3;
  readonly currentShooterPosition: Vec3;
  readonly fireFraction: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly targetTick: number;
  readonly targetFraction: number;
  readonly scoped: boolean;
  readonly targets: readonly HitscanTarget[];
  readonly shooterDucked?: boolean;
}

/** Resolves the fire-contract ray against rewound target capsules. */
export function resolveHitscan(input: HitscanInput): readonly CombatHit[] {
  const origin = shooterEye(
    input.previousShooterPosition,
    input.currentShooterPosition,
    input.fireFraction,
    input.shooterDucked ?? false,
  );
  const base = fireDirection(input.yaw, input.pitch);
  const spread = input.scoped ? input.weapon.scopedSpreadDegrees : input.weapon.spreadDegrees;
  const pelletCount = Math.max(1, input.weapon.pellets);
  const hits: CombatHit[] = [];
  for (let pellet = 0; pellet < pelletCount; pellet += 1) {
    const direction = spreadDirection(base, spread, input.commandSequence * 31 + pellet);
    let nearest: CombatHit | undefined;
    for (const target of input.targets) {
      const hull = rewindHull(
        target.history,
        input.targetTick,
        input.targetFraction,
        target.generation,
      );
      if (hull === undefined) continue;
      const height = hull.ducked === true ? DUCKED_CAPSULE_HEIGHT : CAPSULE_HEIGHT;
      const intersection = rayVerticalCapsule(origin, direction, hull.position, height);
      if (intersection === undefined || intersection.distance > input.weapon.range) continue;
      const damage = Math.round(
        input.weapon.damage * (intersection.head ? input.weapon.headMultiplier : 1) +
        (intersection.head ? input.weapon.headBonus : 0),
      );
      if (nearest === undefined || intersection.distance < nearest.distance) {
        nearest = {
          targetId: target.id,
          distance: intersection.distance,
          headshot: intersection.head,
          damage,
          point: addScaled(origin, direction, intersection.distance),
        };
      }
    }
    if (nearest !== undefined) hits.push(nearest);
  }
  return hits;
}

export function resolveMelee(input: HitscanInput): CombatHit | undefined {
  const origin = shooterEye(
    input.previousShooterPosition,
    input.currentShooterPosition,
    input.fireFraction,
    input.shooterDucked ?? false,
  );
  const direction = fireDirection(input.yaw, input.pitch);
  let nearest: CombatHit | undefined;
  for (const target of input.targets) {
    const hull = rewindHull(target.history, input.targetTick, input.targetFraction, target.generation);
    if (hull === undefined) continue;
    const center = {
      x: hull.position.x,
      y: hull.position.y + (hull.ducked === true ? DUCKED_CAPSULE_HEIGHT : CAPSULE_HEIGHT) * 0.5,
      z: hull.position.z,
    };
    const dx = center.x - origin.x;
    const dy = center.y - origin.y;
    const dz = center.z - origin.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > input.weapon.range + CAPSULE_RADIUS || distance <= 1e-6) continue;
    const facing = (dx * direction.x + dy * direction.y + dz * direction.z) / distance;
    if (facing < input.weapon.meleeConeCos) continue;
    if (nearest === undefined || distance < nearest.distance) {
      nearest = {
        targetId: target.id,
        distance,
        headshot: false,
        damage: input.weapon.damage,
        point: center,
      };
    }
  }
  return nearest;
}

export interface ProjectileState {
  readonly id: number;
  readonly generation: number;
  readonly ownerId: number;
  readonly ownerGeneration: number;
  readonly fireCmdSeq: number;
  readonly weaponId: WeaponIdValue;
  readonly spawnTick: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export interface ProjectileImpact {
  readonly point: Vec3;
  readonly normal: Vec3;
}

export interface ProjectileWorld {
  sweepProjectile(from: Vec3, to: Vec3, radius: number): ProjectileImpact | undefined;
  projectileInKillVolume(position: Vec3, radius: number): boolean;
}

export interface ProjectileTarget {
  readonly id: number;
  readonly generation: number;
  readonly alive: boolean;
  readonly position: Vec3;
  readonly ducked: boolean;
}

export interface ProjectileDetonation {
  readonly projectile: ProjectileState;
  readonly point: Vec3;
  readonly directTargetId?: number;
  readonly reason: "impact" | "target" | "kill-volume" | "lifetime";
}

export function segmentPointDistance(from: Vec3, to: Vec3, point: Vec3): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const denominator = dx * dx + dy * dy + dz * dz;
  const alpha = denominator === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) / denominator,
  ));
  return Math.hypot(
    from.x + dx * alpha - point.x,
    from.y + dy * alpha - point.y,
    from.z + dz * alpha - point.z,
  );
}

export interface NearMissGeometry {
  readonly distance: number;
  readonly closingSpeed: number;
}

export function nearMissGeometry(
  from: Vec3,
  to: Vec3,
  velocity: Vec3,
  head: Vec3,
): NearMissGeometry {
  const distance = segmentPointDistance(from, to, head);
  const offset = {
    x: from.x - head.x,
    y: from.y - head.y,
    z: from.z - head.z,
  };
  const length = Math.max(1e-6, Math.hypot(offset.x, offset.y, offset.z));
  const closingSpeed = Math.max(0,
    -(offset.x * velocity.x + offset.y * velocity.y + offset.z * velocity.z) / length);
  return { distance, closingSpeed };
}

export class ProjectileSystem {
  private readonly live = new Map<number, ProjectileState>();
  private readonly generations = new Map<number, number>();
  private readonly pendingDetonations: ProjectileDetonation[] = [];
  private nextId = 0x8000;
  private readonly nearMissSeen = new Map<number, Set<number>>();
  private pendingNearMisses: Array<{
    projectile: ProjectileState;
    targetId: number;
    closingSpeed: number;
  }> = [];

  get projectiles(): readonly ProjectileState[] {
    return [...this.live.values()].sort((left, right) => left.id - right.id);
  }

  get nearMissDedupeSize(): number {
    let size = 0;
    for (const targets of this.nearMissSeen.values()) size += targets.size;
    return size;
  }

  spawn(
    ownerId: number,
    ownerGeneration: number,
    fireCmdSeq: number,
    weaponId: WeaponIdValue,
    position: Vec3,
    direction: Vec3,
    tick: number,
  ): ProjectileState | undefined {
    const weapon = WEAPONS[weaponId];
    if (weapon.kind !== "projectile") return undefined;
    const owned = [...this.live.values()]
      .filter((projectile) => projectile.ownerId === ownerId)
      .sort((left, right) => left.spawnTick - right.spawnTick || left.id - right.id);
    if (owned.length >= weapon.projectileLiveCap) {
      const oldest = owned[0];
      if (oldest !== undefined) {
        this.removeLive(oldest.id);
        this.pendingDetonations.push({
          projectile: oldest,
          point: oldest.position,
          reason: "lifetime",
        });
      }
    }
    const id = this.nextId;
    const generation = ((this.generations.get(id) ?? 0) + 1) & 0xffff || 1;
    this.generations.set(id, generation);
    const projectile: ProjectileState = {
      id,
      generation,
      ownerId,
      ownerGeneration,
      fireCmdSeq,
      weaponId,
      spawnTick: tick,
      position: { ...position },
      velocity: {
        x: direction.x * weapon.projectileSpeed,
        y: direction.y * weapon.projectileSpeed,
        z: direction.z * weapon.projectileSpeed,
      },
    };
    this.nextId = this.nextId >= 0xfffe ? 0x8000 : this.nextId + 1;
    this.live.set(projectile.id, projectile);
    return projectile;
  }

  delete(id: number): void {
    this.removeLive(id);
  }

  drainNearMisses(): readonly {
    projectile: ProjectileState;
    targetId: number;
    closingSpeed: number;
  }[] {
    return this.pendingNearMisses.splice(0);
  }

  tick(tick: number, world: ProjectileWorld | undefined, targets: readonly ProjectileTarget[]): readonly ProjectileDetonation[] {
    const detonations = this.pendingDetonations.splice(0);
    for (const projectile of this.projectiles) {
      const weapon = WEAPONS[projectile.weaponId];
      if (tick - projectile.spawnTick >= weapon.projectileLifetimeTicks) {
        this.removeLive(projectile.id);
        detonations.push({ projectile, point: projectile.position, reason: "lifetime" });
        continue;
      }
      const velocity = {
        ...projectile.velocity,
        y: projectile.velocity.y - weapon.projectileGravity * TICK_DT,
      };
      const next = addScaled(projectile.position, velocity, TICK_DT);
      if (world?.projectileInKillVolume(next, weapon.projectileRadius) === true) {
        this.removeLive(projectile.id);
        detonations.push({ projectile, point: next, reason: "kill-volume" });
        continue;
      }
      const worldImpact = world?.sweepProjectile(projectile.position, next, weapon.projectileRadius);
      if (worldImpact !== undefined) {
        this.removeLive(projectile.id);
        detonations.push({ projectile, point: worldImpact.point, reason: "impact" });
        continue;
      }
      let direct: ProjectileTarget | undefined;
      let distance = Infinity;
      const nearMisses: Array<{ target: ProjectileTarget; closingSpeed: number }> = [];
      for (const target of targets) {
        if (!target.alive) continue;
        if (target.id === projectile.ownerId && tick - projectile.spawnTick <= 2) continue;
        const height = target.ducked ? DUCKED_CAPSULE_HEIGHT : CAPSULE_HEIGHT;
        const centers = [
          { x: target.position.x, y: target.position.y + CAPSULE_RADIUS, z: target.position.z },
          { x: target.position.x, y: target.position.y + height * 0.5, z: target.position.z },
          { x: target.position.x, y: target.position.y + height - CAPSULE_RADIUS, z: target.position.z },
        ];
        const hitDistance = Math.min(...centers.map((center) => segmentPointDistance(projectile.position, next, center)));
        if (hitDistance <= CAPSULE_RADIUS + weapon.projectileRadius && hitDistance < distance) {
          direct = target;
          distance = hitDistance;
        } else {
          const head = {
            x: target.position.x,
            y: target.position.y + height - CAPSULE_RADIUS * 0.5,
            z: target.position.z,
          };
          const geometry = nearMissGeometry(projectile.position, next, velocity, head);
          if (geometry.distance <= NEAR_MISS_DIALS.radius && geometry.closingSpeed > 0) {
            nearMisses.push({ target, closingSpeed: geometry.closingSpeed });
          }
        }
      }
      if (direct !== undefined) {
        this.removeLive(projectile.id);
        detonations.push({ projectile, point: next, directTargetId: direct.id, reason: "target" });
        continue;
      }
      for (const nearMiss of nearMisses) {
        let seenTargets = this.nearMissSeen.get(projectile.id);
        if (seenTargets === undefined) {
          seenTargets = new Set<number>();
          this.nearMissSeen.set(projectile.id, seenTargets);
        }
        if (seenTargets.has(nearMiss.target.id)) continue;
        seenTargets.add(nearMiss.target.id);
        this.pendingNearMisses.push({
          projectile,
          targetId: nearMiss.target.id,
          closingSpeed: nearMiss.closingSpeed,
        });
      }
      this.live.set(projectile.id, { ...projectile, position: next, velocity });
    }
    return detonations;
  }

  private removeLive(id: number): void {
    this.live.delete(id);
    this.nearMissSeen.delete(id);
  }
}

export interface SplashTarget {
  readonly id: number;
  readonly position: Vec3;
}

export interface SplashEffect {
  readonly targetId: number;
  readonly damage: number;
  readonly impulse: Vec3;
  readonly direct: boolean;
}

export function resolveSplash(
  weapon: WeaponDefinition,
  point: Vec3,
  targets: readonly SplashTarget[],
  ownerId: number,
  directTargetId?: number,
): readonly SplashEffect[] {
  const effects: SplashEffect[] = [];
  for (const target of targets) {
    const dx = target.position.x - point.x;
    const dy = target.position.y + 0.9 - point.y;
    const dz = target.position.z - point.z;
    const distance = Math.hypot(dx, dy, dz);
    const direct = target.id === directTargetId;
    if (!direct && distance > weapon.splashRadius) continue;
    const falloff = direct ? 1 : Math.max(0, 1 - distance / Math.max(0.001, weapon.splashRadius));
    const shaped = falloff ** weapon.splashFalloffExponent;
    let damage = weapon.splashDamage * shaped + (direct ? weapon.damage + weapon.directHitBonus : 0);
    if (target.id === ownerId) damage *= weapon.selfDamageScalar;
    const normalLength = Math.max(0.1, distance);
    const impulseScale = weapon.knockback * Math.max(0.12, shaped);
    effects.push({
      targetId: target.id,
      damage: Math.round(damage),
      direct,
      impulse: {
        x: dx / normalLength * impulseScale,
        y: Math.max(0.35, dy / normalLength) * impulseScale,
        z: dz / normalLength * impulseScale,
      },
    });
  }
  return effects;
}

/** Client-side ownership matcher used during prediction reconciliation. */
export class OwnProjectilePrediction {
  private readonly predicted = new Map<string, ProjectileState>();

  private key(ownerId: number, fireCmdSeq: number): string {
    return `${ownerId}:${fireCmdSeq}`;
  }

  add(projectile: ProjectileState): void {
    this.predicted.set(this.key(projectile.ownerId, projectile.fireCmdSeq), projectile);
  }

  remove(ownerId: number, fireCmdSeq: number): void {
    this.predicted.delete(this.key(ownerId, fireCmdSeq));
  }

  reconcile(replicated: readonly ProjectileState[]): readonly ProjectileState[] {
    const authoritativeKeys = new Set<string>();
    for (const projectile of replicated) {
      const key = this.key(projectile.ownerId, projectile.fireCmdSeq);
      authoritativeKeys.add(key);
      if (this.predicted.has(key)) this.predicted.set(key, projectile);
    }
    for (const [key, projectile] of this.predicted) {
      if (authoritativeKeys.has(key)) continue;
      // An unreplicated projectile remains predicted until the command is acked;
      // callers explicitly remove it then, preserving local detonation replay.
      this.predicted.set(key, projectile);
    }
    return [...this.predicted.values()];
  }
}
