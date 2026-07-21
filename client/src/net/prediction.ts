import {
  DEFAULT_FEEL,
  TICK_DT,
  WEAPONS,
  WeaponId,
  type FeelParams,
  type Vec3,
  type WeaponIdValue,
} from "@gungame/shared";
import { EntityKind, type EntityState } from "@gungame/protocol";
import {
  DEFAULT,
  Buttons,
  continuesBurst,
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
  // Fire-presentation state (F2). Deliberately SEPARATE from nextFireTick:
  // that one resets on every reconcile so projectile replay stays correct,
  // but presentation cadence must survive reconciles or held fire would
  // re-trigger at snapshot rate instead of the weapon's refire rate.
  private presentationNextFireTick = 0;
  private presentationLastShotTick = -1_000;
  private presentationBurstIndex = 0;
  private readonly firedEvents: Array<{ weaponId: WeaponIdValue; burstIndex: number }> = [];
  private presentationFrozen = false;
  private presentationAmmoEmpty = false;

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
    // Presentation events come ONLY from the live predict path — reconcile
    // replays the same cmds and must never re-emit a shot the player already
    // saw. (F2)
    this.emitFirePresentation(cmd, this.predicted.tick);
    return this.predicted;
  }

  /**
   * Update the server-truth gates that suppress fire presentation: round
   * freeze (server ignores fire while frozen) and an empty magazine on
   * ammo-tracked weapons. Both are replicated state — at worst one RTT stale,
   * which is far better than presenting shots the server will never resolve.
   */
  setPresentationGates(frozen: boolean, ammoEmpty: boolean): void {
    this.presentationFrozen = frozen;
    this.presentationAmmoEmpty = ammoEmpty;
  }

  /**
   * Fired-weapon presentation queue since the last drain, in tick order.
   * The melee modifier is resolved here (a melee attack presents the knife,
   * not the ladder weapon), mirroring the server's weapon swap.
   */
  drainFirePresentations(): ReadonlyArray<{ weaponId: WeaponIdValue; burstIndex: number }> {
    if (this.firedEvents.length === 0) return this.firedEvents;
    return this.firedEvents.splice(0);
  }

  private emitFirePresentation(cmd: Cmd, tick: number): void {
    // Mirrors the server exactly (rooms.fire): the Fire pulse triggers the
    // shot; the Melee bit only swaps the resolved weapon to the knife.
    if ((cmd.buttons & Buttons.Fire) === 0) return;
    if (this.presentationFrozen) return;
    // Before the first snapshot configures combat, present the server's
    // tier-1 default so pre-welcome/practice fire is not silent.
    const base = this.weaponId ?? WeaponId.Pistol;
    const melee = (cmd.buttons & Buttons.Melee) !== 0;
    const effective = melee ? WeaponId.Knife : base;
    if (this.presentationAmmoEmpty && !melee) return;
    if (tick < this.presentationNextFireTick) return;
    const weapon = WEAPONS[effective];
    // Mirror the server's burst rule so the camera-kick pattern index matches
    // the bullet-path pattern index (hybrid meta spray parity).
    this.presentationBurstIndex = continuesBurst(weapon, this.presentationLastShotTick, tick)
      ? this.presentationBurstIndex + 1
      : 0;
    this.presentationLastShotTick = tick;
    this.firedEvents.push({ weaponId: effective, burstIndex: this.presentationBurstIndex });
    this.presentationNextFireTick = tick + weapon.refireTicks;
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
    this.presentationNextFireTick = 0;
    this.presentationLastShotTick = -1_000;
    this.presentationBurstIndex = 0;
    this.firedEvents.length = 0;
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
