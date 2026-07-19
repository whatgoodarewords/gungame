import {
  DEFAULT_FEEL,
  TICK_DT,
  WEAPONS,
  type FeelParams,
  type Vec3,
  type WeaponIdValue,
} from "@gungame/shared";
import { EntityKind, type EntityState } from "@gungame/protocol";
import {
  DEFAULT,
  Buttons,
  OwnProjectilePrediction,
  ProjectileSystem,
  fireDirection,
  resolveSplash,
  shooterEye,
  type Cmd,
  type CollisionWorld,
  type MoveParams,
  type State,
  step,
  type ProjectileState,
} from "@gungame/sim";

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

export class PredictionReconciler {
  private predicted: State;
  private readonly unacked: Cmd[] = [];
  private renderError: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly world: CollisionWorld | undefined;
  private params: MoveParams = DEFAULT;
  private feel: FeelParams = DEFAULT_FEEL;
  private projectileSystem = new ProjectileSystem();
  private projectileMatcher = new OwnProjectilePrediction();
  private matchedProjectiles: readonly ProjectileState[] = [];
  private ownerId = 0;
  private ownerGeneration = 0;
  private weaponId: WeaponIdValue | undefined;
  private nextFireTick = 0;

  constructor(initial: State, world?: CollisionWorld) {
    this.predicted = initial;
    this.world = world;
  }

  get state(): State {
    return this.predicted;
  }

  configure(params: MoveParams, feel: FeelParams): void {
    this.params = { ...params };
    this.feel = { ...feel };
  }

  configureCombat(ownerId: number, generation: number, weaponId: WeaponIdValue): void {
    this.ownerId = ownerId;
    this.ownerGeneration = generation;
    if (this.weaponId !== weaponId) this.nextFireTick = 0;
    this.weaponId = weaponId;
  }

  get predictedProjectiles(): readonly ProjectileState[] {
    return this.matchedProjectiles;
  }

  predict(cmd: Cmd): State {
    this.unacked.push(cmd);
    const previous = this.predicted;
    const moved = step(
      this.predicted,
      cmd,
      TICK_DT,
      {
        ...(this.world === undefined ? {} : { world: this.world }),
        params: this.params,
        feel: this.feel,
      },
    );
    this.predicted = this.predictCombat(previous, moved, cmd);
    return this.predicted;
  }

  reconcile(
    authoritative: State,
    lastProcessedCmdSeq: number,
    resetRenderOffset = false,
  ): State {
    const oldPosition = this.predicted.player.position;
    while ((this.unacked[0]?.seq ?? Infinity) <= lastProcessedCmdSeq) {
      const acknowledged = this.unacked.shift();
      if (acknowledged !== undefined) this.projectileMatcher.remove(this.ownerId, acknowledged.seq);
    }
    this.projectileSystem = new ProjectileSystem();
    this.projectileMatcher = new OwnProjectilePrediction();
    this.nextFireTick = 0;
    let rebuilt = authoritative;
    for (const cmd of this.unacked) {
      const previous = rebuilt;
      const moved = step(
        rebuilt,
        cmd,
        TICK_DT,
        {
          ...(this.world === undefined ? {} : { world: this.world }),
          params: this.params,
          feel: this.feel,
        },
      );
      rebuilt = this.predictCombat(previous, moved, cmd);
    }
    this.predicted = rebuilt;
    const correction = subtract(oldPosition, rebuilt.player.position);
    this.renderError = resetRenderOffset || length(correction) > 0.5
      ? { x: 0, y: 0, z: 0 }
      : {
          x: this.renderError.x + correction.x,
          y: this.renderError.y + correction.y,
          z: this.renderError.z + correction.z,
        };
    this.constrainRenderError();
    return this.predicted;
  }

  renderPosition(dtSeconds: number): Vec3 {
    const decay = Math.exp(-Math.max(0, dtSeconds) / 0.1);
    this.renderError = {
      x: this.renderError.x * decay,
      y: this.renderError.y * decay,
      z: this.renderError.z * decay,
    };
    this.constrainRenderError();
    return {
      x: this.predicted.player.position.x + this.renderError.x,
      y: this.predicted.player.position.y + this.renderError.y,
      z: this.predicted.player.position.z + this.renderError.z,
    };
  }

  resetForEpoch(authoritative: State): void {
    this.unacked.length = 0;
    this.predicted = authoritative;
    this.renderError = { x: 0, y: 0, z: 0 };
    this.projectileSystem = new ProjectileSystem();
    this.projectileMatcher = new OwnProjectilePrediction();
    this.matchedProjectiles = [];
    this.nextFireTick = 0;
  }

  reconcileProjectiles(entities: readonly EntityState[]): readonly ProjectileState[] {
    const replicated = entities
      .filter((entity) => entity.kind === EntityKind.Projectile && entity.ownerId === this.ownerId)
      .map((entity): ProjectileState => ({
        id: entity.id,
        generation: entity.generation,
        ownerId: entity.ownerId,
        ownerGeneration: this.ownerGeneration,
        fireCmdSeq: entity.fireCmdSeq,
        weaponId: entity.weaponId as WeaponIdValue,
        spawnTick: 0,
        position: entity.position,
        velocity: entity.velocity,
      }));
    this.matchedProjectiles = this.projectileMatcher.reconcile(replicated);
    return this.matchedProjectiles;
  }

  private predictCombat(previous: State, moved: State, cmd: Cmd): State {
    let result = moved;
    const weaponId = this.weaponId;
    if (
      weaponId !== undefined &&
      WEAPONS[weaponId].kind === "projectile" &&
      (cmd.buttons & Buttons.Fire) !== 0 &&
      moved.tick >= this.nextFireTick
    ) {
      const weapon = WEAPONS[weaponId];
      const projectile = this.projectileSystem.spawn(
        this.ownerId,
        this.ownerGeneration,
        cmd.seq,
        weaponId,
        shooterEye(previous.player.position, moved.player.position, cmd.fireFraction, moved.player.ducked),
        fireDirection(cmd.viewYaw, cmd.viewPitch),
        moved.tick,
      );
      if (projectile !== undefined) this.projectileMatcher.add(projectile);
      this.nextFireTick = moved.tick + weapon.refireTicks;
    }
    const detonations = this.projectileSystem.tick(moved.tick, this.world, [{
      id: this.ownerId,
      generation: this.ownerGeneration,
      alive: true,
      position: moved.player.position,
      ducked: moved.player.ducked,
    }]);
    for (const projectile of this.projectileSystem.projectiles) this.projectileMatcher.add(projectile);
    for (const detonation of detonations) {
      this.projectileMatcher.remove(detonation.projectile.ownerId, detonation.projectile.fireCmdSeq);
      if (detonation.reason !== "impact" && detonation.reason !== "target") continue;
      const effect = resolveSplash(
        WEAPONS[detonation.projectile.weaponId],
        detonation.point,
        [{ id: this.ownerId, position: moved.player.position }],
        this.ownerId,
      )[0];
      if (effect === undefined) continue;
      result = {
        ...result,
        player: {
          ...result.player,
          velocity: {
            x: result.player.velocity.x + effect.impulse.x,
            y: result.player.velocity.y + effect.impulse.y,
            z: result.player.velocity.z + effect.impulse.z,
          },
        },
      };
    }
    this.matchedProjectiles = this.projectileMatcher.reconcile([]);
    return result;
  }

  private constrainRenderError(): void {
    if (this.world === undefined) return;
    const candidate = {
      x: this.predicted.player.position.x + this.renderError.x,
      y: this.predicted.player.position.y + this.renderError.y,
      z: this.predicted.player.position.z + this.renderError.z,
    };
    if (!this.world.capsuleFits(candidate)) this.renderError = { x: 0, y: 0, z: 0 };
  }
}
