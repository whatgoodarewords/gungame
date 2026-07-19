import { randomBytes } from "node:crypto";

import {
  CmdAcceptanceWindow,
  EntityKind,
  EventFlags,
  EventJournal,
  EventKind,
  FrameType,
  GameMode,
  GravityVariant,
  JoinKind,
  Ladder,
  MapId,
  MapPreference,
  ProtocolError,
  RoundState,
  ServerBaselineEpochs,
  SnapshotRing,
  packSnapshot,
  type CmdFrame,
  type EntityState,
  type HelloFrame,
  type SnapshotEvent,
  type SnapshotModeState,
} from "@gungame/protocol";
import {
  LadderId,
  MapSecretKind,
  MAX_HEALTH,
  RESPAWN_TICKS,
  TICK_DT,
  WeaponId,
  WEAPONS,
  ladderWeapons,
  type LadderIdValue,
  type MapSpawn,
  type MapSecret,
  type Vec3,
  type WeaponDefinition,
  type WeaponIdValue,
} from "@gungame/shared";
import {
  Buttons,
  DEFAULT,
  ModeRules,
  ProjectileSystem,
  SCOUTZ,
  createInitialState,
  fireDirection,
  resolveHitscan,
  resolveMelee,
  resolveSplash,
  shooterEye,
  step,
  validateFireTarget,
  type CollisionWorld,
  type Cmd,
  type HullHistorySample,
  type ProjectileDetonation,
  type ProjectileState,
  type State,
} from "@gungame/sim";

import { FixedRing } from "./ring.js";

const MAX_PLAYERS = 12;
const RECONNECT_HOLD_MS = 45_000;
const EMPTY_REAP_MS = 5 * 60_000;
const AFK_MS = 30_000;
const HULL_RING_TICKS = Math.ceil(0.4 / TICK_DT) + 1;
const SENT_TICK_RING = 64;

export interface PlayerPeer {
  sendReliable(bytes: Uint8Array): void;
  sendBaseline(bytes: Uint8Array): void;
  sendSnapshot(bytes: Uint8Array): void;
  disconnect(code: number, reason: string): void;
}

export interface RoomConfig {
  readonly mode: typeof GameMode[keyof typeof GameMode];
  readonly variant: typeof GravityVariant[keyof typeof GravityVariant];
  readonly ladder: typeof Ladder[keyof typeof Ladder];
  readonly mapPreference: typeof MapPreference[keyof typeof MapPreference];
}

export interface HullSample extends HullHistorySample {
  readonly ducked: boolean;
  readonly grounded: boolean;
}

export interface PlayerSlot {
  readonly id: number;
  readonly name: string;
  readonly cmdWindow: CmdAcceptanceWindow;
  readonly snapshots: SnapshotRing;
  readonly events: EventJournal;
  readonly epochs: ServerBaselineEpochs;
  readonly hulls: FixedRing<HullSample>;
  readonly sentSnapshotTicks: FixedRing<number>;
  state: State;
  generation: number;
  health: number;
  alive: boolean;
  respawnTick: number;
  tier: number;
  team: 0 | 1 | 2;
  kills: number;
  deaths: number;
  ammo: number;
  nextFireTick: number;
  reloadTick: number;
  peer: PlayerPeer | undefined;
  tokenHex: string;
  token: Uint8Array;
  holdUntilMs: number;
  lastCmd: CmdFrame | undefined;
  repeatTicks: number;
  ackedSnapshotTick: number;
  lastInputMs: number;
  lastAcceptedTargetExact: number | undefined;
  airborneSinceTick: number;
  backgroundSinceMs: number;
}

export interface JoinSuccess {
  readonly room: Room;
  readonly slot: PlayerSlot;
  readonly token: Uint8Array;
  readonly resumed: boolean;
}

export type JoinResult =
  | JoinSuccess
  | { readonly refusal: "room-full" | "room-create-refused" | "room-not-found" | "invalid-name" };

function tokenBytes(): Uint8Array {
  return new Uint8Array(randomBytes(16));
}

function tokenKey(token: Uint8Array): string {
  let result = "";
  for (const byte of token) result += byte.toString(16).padStart(2, "0");
  return result;
}

/** Strip controls before enforcing the normative ASCII name contract. */
export function validatePlayerName(input: string): string | undefined {
  const stripped = input.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  if (stripped.length < 2 || stripped.length > 16) return undefined;
  return /^[a-zA-Z0-9_ -]+$/.test(stripped) ? stripped : undefined;
}

function toSimCmd(frame: CmdFrame, buttons = frame.buttons): Cmd {
  return {
    seq: frame.seq,
    tick: frame.tick,
    buttons,
    viewYaw: frame.viewYaw,
    viewPitch: frame.viewPitch,
    fireFraction: frame.fireFraction,
    lastSnapshotTick: frame.lastSnapshotTick,
    interpTargetTick: frame.interpTargetTick,
    interpTargetFraction: frame.interpTargetFraction,
  };
}

function playerEntity(slot: PlayerSlot): EntityState {
  return {
    id: slot.id,
    generation: slot.generation,
    kind: EntityKind.Player,
    position: slot.state.player.position,
    velocity: slot.state.player.velocity,
    viewYaw: slot.state.player.viewYaw,
    viewPitch: slot.state.player.viewPitch,
    grounded: slot.state.player.grounded,
    alive: slot.alive,
    health: slot.health,
    weaponTier: slot.tier,
    ammo: slot.ammo,
    ownerId: 0,
    fireCmdSeq: 0,
    weaponId: 0,
  };
}

function projectileEntity(projectile: ProjectileState): EntityState {
  return {
    id: projectile.id,
    generation: projectile.generation,
    kind: EntityKind.Projectile,
    position: projectile.position,
    velocity: projectile.velocity,
    viewYaw: 0,
    viewPitch: 0,
    grounded: false,
    alive: true,
    health: 0,
    weaponTier: 0,
    ammo: 0,
    ownerId: projectile.ownerId,
    fireCmdSeq: projectile.fireCmdSeq,
    weaponId: projectile.weaponId,
  };
}

function initialAmmo(weaponId: WeaponIdValue): number {
  const magazine = WEAPONS[weaponId].magazine;
  return magazine === 0 ? 0 : magazine;
}

function clampU16(value: number): number {
  return Math.max(0, Math.min(0xffff, Math.floor(value)));
}

function segmentIntersectsAabb(start: Vec3, end: Vec3, bounds: { min: Vec3; max: Vec3 }): boolean {
  let near = 0;
  let far = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-8) {
      if (start[axis] < bounds.min[axis] || start[axis] > bounds.max[axis]) return false;
      continue;
    }
    const inverse = 1 / delta;
    let first = (bounds.min[axis] - start[axis]) * inverse;
    let second = (bounds.max[axis] - start[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return false;
  }
  return far >= 0 && near <= 1;
}

interface PendingFire {
  readonly slot: PlayerSlot;
  readonly cmd: CmdFrame;
  readonly previousPosition: Vec3;
}

export class Room {
  readonly players = new Map<number, PlayerSlot>();
  readonly config: RoomConfig;
  readonly id: string;
  readonly rules: ModeRules;
  readonly projectiles = new ProjectileSystem();
  private nextPlayerId = 1;
  private nextEventId = 1;
  private lastNonEmptyMs: number;
  private world: CollisionWorld | undefined;
  private spawns: readonly MapSpawn[];
  private secrets: readonly MapSecret[];
  private readonly mapRotation: readonly RoomMapBinding[];
  private mapRotationIndex: number;
  private activeMapId: typeof MapId[keyof typeof MapId];
  private secretTriggered = false;
  private lastServerTick = 0;

  constructor(
    id: string,
    config: RoomConfig,
    world: CollisionWorld | undefined,
    nowMs: number,
    spawns: readonly (MapSpawn | Vec3)[] = [],
    secrets: readonly MapSecret[] = [],
    mapId: typeof MapId[keyof typeof MapId] = config.mode === GameMode.Scoutzknivez
      ? MapId.Spire
      : MapId.Foundry,
    mapRotation: readonly RoomMapBinding[] = [],
  ) {
    this.id = id;
    this.config = Object.freeze({ ...config });
    this.world = world;
    this.spawns = spawns.map((spawn) => "position" in spawn
      ? spawn
      : { mode: config.mode, team: 0, position: spawn, yaw: 0 });
    this.secrets = secrets;
    this.activeMapId = mapId;
    this.mapRotation = mapRotation;
    this.mapRotationIndex = Math.max(0, mapRotation.findIndex((entry) => entry.mapId === mapId));
    this.lastNonEmptyMs = nowMs;
    this.rules = new ModeRules(config.mode as 0 | 1, config.ladder as LadderIdValue);
  }

  get connectedCount(): number {
    let count = 0;
    for (const slot of this.players.values()) if (slot.peer !== undefined) count += 1;
    return count;
  }

  get isFull(): boolean {
    return this.players.size >= MAX_PLAYERS;
  }

  get emptySinceMs(): number {
    return this.lastNonEmptyMs;
  }

  get mapId(): typeof MapId[keyof typeof MapId] {
    return this.activeMapId;
  }

  add(peer: PlayerPeer, nowMs: number, rawName = "Player"): JoinSuccess | undefined {
    this.expireHolds(nowMs);
    if (this.isFull) return undefined;
    const name = validatePlayerName(rawName);
    if (name === undefined) return undefined;
    const id = this.nextPlayerId;
    this.nextPlayerId += 1;
    const token = tokenBytes();
    const modePlayer = this.rules.addPlayer(id);
    const spawn = this.spawnFor(id, modePlayer.team, 1);
    const initial = createInitialState(`player-${id}`);
    const state: State = {
      ...initial,
      tick: this.lastServerTick,
      player: {
        ...initial.player,
        ...(spawn === undefined ? {} : { position: { ...spawn.position }, viewYaw: spawn.yaw * 180 / Math.PI }),
      },
    };
    const weaponId = this.weaponForTier(modePlayer.tier);
    const slot: PlayerSlot = {
      id,
      name,
      state,
      generation: 1,
      health: MAX_HEALTH,
      alive: true,
      respawnTick: 0,
      tier: modePlayer.tier,
      team: modePlayer.team,
      kills: 0,
      deaths: 0,
      ammo: initialAmmo(weaponId),
      nextFireTick: 0,
      reloadTick: 0,
      cmdWindow: new CmdAcceptanceWindow(),
      snapshots: new SnapshotRing(),
      events: new EventJournal(),
      epochs: new ServerBaselineEpochs(),
      hulls: new FixedRing(HULL_RING_TICKS),
      sentSnapshotTicks: new FixedRing(SENT_TICK_RING),
      peer,
      token,
      tokenHex: tokenKey(token),
      holdUntilMs: 0,
      lastCmd: undefined,
      repeatTicks: 0,
      ackedSnapshotTick: 0,
      lastInputMs: nowMs,
      lastAcceptedTargetExact: undefined,
      airborneSinceTick: 0,
      backgroundSinceMs: 0,
    };
    this.players.set(id, slot);
    this.lastNonEmptyMs = nowMs;
    return { room: this, slot, token: token.slice(), resumed: false };
  }

  resume(token: Uint8Array, peer: PlayerPeer, nowMs: number): JoinSuccess | undefined {
    const key = tokenKey(token);
    for (const slot of this.players.values()) {
      if (slot.tokenHex !== key || (slot.peer === undefined && slot.holdUntilMs < nowMs)) continue;
      const superseded = slot.peer;
      const rotated = tokenBytes();
      slot.token = rotated;
      slot.tokenHex = tokenKey(rotated);
      slot.peer = peer;
      slot.holdUntilMs = 0;
      slot.repeatTicks = 0;
      slot.lastInputMs = nowMs;
      slot.backgroundSinceMs = 0;
      superseded?.disconnect(4001, "superseded");
      this.lastNonEmptyMs = nowMs;
      return { room: this, slot, token: rotated.slice(), resumed: true };
    }
    return undefined;
  }

  disconnect(slotId: number, nowMs: number, peer?: PlayerPeer): void {
    const slot = this.players.get(slotId);
    if (slot === undefined || (peer !== undefined && slot.peer !== peer)) return;
    slot.peer = undefined;
    slot.holdUntilMs = nowMs + RECONNECT_HOLD_MS;
    if (this.connectedCount === 0) this.lastNonEmptyMs = nowMs;
  }

  acceptCmd(slotId: number, cmd: CmdFrame, nowMs = performance.now()): boolean {
    const slot = this.players.get(slotId);
    const accepted = slot?.cmdWindow.accept(cmd) ?? false;
    if (accepted && slot !== undefined) slot.lastInputMs = nowMs;
    return accepted;
  }

  acknowledgeBaseline(slotId: number, epoch: number, snapshotTick: number): void {
    const slot = this.players.get(slotId);
    if (slot === undefined) throw new ProtocolError("unknown player");
    slot.epochs.acknowledge(epoch, snapshotTick);
    slot.ackedSnapshotTick = snapshotTick;
    slot.events.acknowledgeBaseline(snapshotTick);
  }

  openBaseline(slotId: number, tick: number): Uint8Array {
    const slot = this.players.get(slotId);
    if (slot === undefined) throw new ProtocolError("unknown player");
    const entities = this.entities();
    slot.snapshots.set(tick, entities);
    slot.sentSnapshotTicks.push(tick);
    const epoch = slot.epochs.openFull(tick);
    return packSnapshot({
      tick,
      lastProcessedCmdSeq: slot.cmdWindow.lastProcessedCmdSeq,
      cmdArrivalMargin: slot.cmdWindow.size - 2,
      baselineEpoch: epoch,
      baselineTick: tick,
      selfId: slot.id,
      entities,
      baselineEntities: [],
      events: slot.events.pendingAfter(0),
      modeState: this.modeState(tick),
      forceFull: true,
    }).bytes;
  }

  tick(serverTick: number, nowMs: number): void {
    this.lastServerTick = serverTick;
    this.expireHolds(nowMs);
    this.kickAfk(nowMs);
    if (this.rules.shouldRestart(serverTick)) this.restartRound(serverTick);
    this.respawnReady(serverTick);

    const pendingFires: PendingFire[] = [];
    for (const slot of this.players.values()) {
      const movementStart = { ...slot.state.player.position };
      let frame: CmdFrame | undefined;
      let fresh = false;
      try {
        const consumed = slot.cmdWindow.consume((epoch) => slot.epochs.classifyReference(epoch));
        if (consumed !== undefined) {
          frame = consumed.cmd;
          fresh = true;
          slot.lastCmd = frame;
          slot.repeatTicks = 0;
          if (
            consumed.epochReference === "current" &&
            frame.lastSnapshotTick > slot.ackedSnapshotTick
          ) {
            if (slot.snapshots.has(frame.lastSnapshotTick)) {
              slot.ackedSnapshotTick = frame.lastSnapshotTick;
              slot.events.acknowledgeBaseline(frame.lastSnapshotTick);
            } else if (!slot.epochs.deltasSuspended) {
              slot.peer?.sendBaseline(this.openBaseline(slot.id, serverTick));
            }
          }
        } else if (slot.lastCmd !== undefined && slot.repeatTicks < 8) {
          slot.repeatTicks += 1;
          frame = slot.lastCmd;
        } else if (slot.lastCmd !== undefined) {
          frame = { ...slot.lastCmd, buttons: slot.lastCmd.buttons & Buttons.Duck };
        }
      } catch (error) {
        slot.peer?.disconnect(4002, error instanceof Error ? error.message : "protocol error");
        slot.peer = undefined;
      }

      if (slot.ammo === 0 && slot.reloadTick !== 0 && serverTick >= slot.reloadTick) {
        slot.ammo = 1;
        slot.reloadTick = 0;
      }
      if (frame !== undefined && (frame.buttons & Buttons.Background) !== 0) {
        if (slot.backgroundSinceMs === 0) slot.backgroundSinceMs = nowMs;
        if (nowMs - slot.backgroundSinceMs >= AFK_MS) {
          slot.peer?.disconnect(4004, "afk");
          this.removePlayer(slot.id);
        }
        continue;
      }
      slot.backgroundSinceMs = 0;
      if (frame !== undefined && slot.peer !== undefined && slot.alive && !this.rules.frozen) {
        const previousPosition = { ...slot.state.player.position };
        const scoutz = this.config.mode === GameMode.Scoutzknivez ||
          this.config.variant === GravityVariant.Scoutz;
        slot.state = step(slot.state, toSimCmd(frame), TICK_DT, {
          ...(this.world === undefined ? {} : { world: this.world }),
          params: scoutz ? SCOUTZ : DEFAULT,
        });
        if (fresh && (frame.buttons & Buttons.Fire) !== 0) {
          pendingFires.push({ slot, cmd: frame, previousPosition });
        }
      }
      const hullHeight = slot.state.player.ducked ? 0.9 : 1.8;
      if (slot.alive && this.world !== undefined && (
        this.world.playerInKillVolume(slot.state.player.position, hullHeight) ||
        this.world.playerCrossesKillVolume(movementStart, slot.state.player.position, hullHeight)
      )) {
        this.damage(slot, slot.id, WEAPONS[WeaponId.Knife], slot.health, serverTick,
          EventFlags.Suicide, true);
      }
      if (slot.state.player.grounded) slot.airborneSinceTick = 0;
      else if (slot.airborneSinceTick === 0) slot.airborneSinceTick = serverTick;
      slot.hulls.push({
        tick: serverTick,
        generation: slot.generation,
        alive: slot.alive,
        position: { ...slot.state.player.position },
        ducked: slot.state.player.ducked,
        grounded: slot.state.player.grounded,
      });
    }

    for (const pending of pendingFires) {
      if (pending.slot.alive) this.fire(pending, serverTick);
    }
    const detonations = this.projectiles.tick(
      serverTick,
      this.world,
      [...this.players.values()].map((slot) => ({
        id: slot.id,
        generation: slot.generation,
        alive: slot.alive,
        position: slot.state.player.position,
        ducked: slot.state.player.ducked,
      })),
    );
    for (const detonation of detonations) this.detonate(detonation, serverTick);
    this.sendSnapshots(serverTick);
  }

  shouldReap(nowMs: number): boolean {
    this.expireHolds(nowMs);
    return this.players.size === 0 && nowMs - this.lastNonEmptyMs >= EMPTY_REAP_MS;
  }

  private currentWeapon(slot: PlayerSlot, buttons = 0): WeaponDefinition {
    if ((buttons & Buttons.Melee) !== 0) return WEAPONS[WeaponId.Knife];
    return WEAPONS[this.weaponForTier(slot.tier)];
  }

  private weaponForTier(tier: number): WeaponIdValue {
    if (this.config.mode === GameMode.Scoutzknivez) return WeaponId.Scout;
    const ladder = ladderWeapons(this.config.ladder as LadderIdValue);
    return ladder[Math.max(0, Math.min(ladder.length - 1, tier - 1))] ?? WeaponId.Pistol;
  }

  private fire(pending: PendingFire, serverTick: number): void {
    const { slot, cmd } = pending;
    const weapon = this.currentWeapon(slot, cmd.buttons);
    if (serverTick < slot.nextFireTick) return;
    if (weapon.id === WeaponId.Goldie && slot.ammo <= 0) return;
    slot.nextFireTick = serverTick + weapon.refireTicks;
    if (weapon.id === WeaponId.Goldie) {
      slot.ammo = 0;
      slot.reloadTick = serverTick + weapon.reloadTicks;
    }
    const estimateTick = Math.max(0, serverTick - 5);
    const validated = validateFireTarget({
      executionTick: serverTick,
      requestedTick: cmd.interpTargetTick,
      requestedFraction: cmd.interpTargetFraction,
      estimateTick,
      estimateFraction: 0,
      sentSnapshotTicks: slot.sentSnapshotTicks.toArray(),
      ...(slot.lastAcceptedTargetExact === undefined
        ? {}
        : { lastAcceptedExactTick: slot.lastAcceptedTargetExact }),
    });
    slot.lastAcceptedTargetExact = validated.tick + validated.fraction / 256;
    const eye = shooterEye(
      pending.previousPosition,
      slot.state.player.position,
      cmd.fireFraction,
      slot.state.player.ducked,
    );
    if (weapon.kind === "projectile") {
      this.projectiles.spawn(
        slot.id,
        slot.generation,
        cmd.seq,
        weapon.id,
        eye,
        fireDirection(cmd.viewYaw, cmd.viewPitch),
        serverTick,
      );
      return;
    }
    if (weapon.kind === "melee") this.tryTriggerSecret(slot, cmd, eye, serverTick);
    const targets = [...this.players.values()]
      .filter((target) => target.id !== slot.id && target.alive &&
        !(this.config.mode === GameMode.Scoutzknivez && target.team === slot.team))
      .map((target) => ({
        id: target.id,
        generation: target.generation,
        history: target.hulls.toArray(),
      }));
    const input = {
      weapon,
      commandSequence: cmd.seq,
      previousShooterPosition: pending.previousPosition,
      currentShooterPosition: slot.state.player.position,
      fireFraction: cmd.fireFraction,
      yaw: cmd.viewYaw,
      pitch: cmd.viewPitch,
      targetTick: validated.tick,
      targetFraction: validated.fraction,
      scoped: (cmd.buttons & Buttons.Zoom) !== 0,
      targets,
      shooterDucked: slot.state.player.ducked,
    };
    const hits = weapon.kind === "melee"
      ? [resolveMelee(input)].filter((hit) => hit !== undefined)
      : resolveHitscan(input);
    const aggregate = new Map<number, { damage: number; headshot: boolean; point: Vec3 }>();
    for (const hit of hits) {
      if (this.world?.sweepProjectile(eye, hit.point, 0) !== undefined) continue;
      const prior = aggregate.get(hit.targetId);
      aggregate.set(hit.targetId, {
        damage: (prior?.damage ?? 0) + hit.damage,
        headshot: (prior?.headshot ?? false) || hit.headshot,
        point: hit.point,
      });
    }
    for (const [targetId, hit] of aggregate) {
      const target = this.players.get(targetId);
      if (target === undefined) continue;
      const flags = (hit.headshot ? EventFlags.Headshot : 0) |
        (weapon.kind === "melee" ? EventFlags.Melee : 0);
      this.damage(target, slot.id, weapon, hit.damage, serverTick, flags, false);
    }
  }

  private detonate(detonation: ProjectileDetonation, tick: number): void {
    if (detonation.reason === "kill-volume" || detonation.reason === "lifetime") return;
    const weapon = WEAPONS[detonation.projectile.weaponId];
    const effects = resolveSplash(
      weapon,
      detonation.point,
      [...this.players.values()].filter((slot) => slot.alive).map((slot) => ({
        id: slot.id,
        position: slot.state.player.position,
      })),
      detonation.projectile.ownerId,
      detonation.directTargetId,
    );
    const owner = this.players.get(detonation.projectile.ownerId);
    const posthumous = owner === undefined || !owner.alive ||
      owner.generation !== detonation.projectile.ownerGeneration;
    for (const effect of effects) {
      const target = this.players.get(effect.targetId);
      if (target === undefined || !target.alive) continue;
      if (owner !== undefined && this.config.mode === GameMode.Scoutzknivez &&
        owner.team === target.team && owner.id !== target.id) continue;
      target.state = {
        ...target.state,
        player: {
          ...target.state.player,
          velocity: {
            x: target.state.player.velocity.x + effect.impulse.x,
            y: target.state.player.velocity.y + effect.impulse.y,
            z: target.state.player.velocity.z + effect.impulse.z,
          },
        },
      };
      const flags = (effect.direct ? EventFlags.Direct : 0) |
        (posthumous ? EventFlags.Posthumous : 0) |
        (target.id === detonation.projectile.ownerId ? EventFlags.Suicide : 0);
      this.damage(target, detonation.projectile.ownerId, weapon, effect.damage, tick, flags,
        target.id === detonation.projectile.ownerId);
    }
  }

  private damage(
    target: PlayerSlot,
    attackerId: number,
    weapon: WeaponDefinition,
    amount: number,
    tick: number,
    flags: number,
    suicide: boolean,
  ): void {
    if (!target.alive || amount <= 0) return;
    const applied = Math.min(target.health, Math.max(0, Math.round(amount)));
    target.health -= applied;
    this.broadcastEvent({
      id: this.nextEvent(), tick, kind: EventKind.Damage, actorId: attackerId,
      targetId: target.id, amount: applied, weaponId: weapon.id, flags,
    });
    if (!suicide && attackerId !== target.id) {
      this.broadcastEvent({
        id: this.nextEvent(), tick, kind: EventKind.HitConfirm, actorId: attackerId,
        targetId: target.id, amount: applied, weaponId: weapon.id, flags,
      });
    }
    if (target.health > 0) return;
    target.alive = false;
    target.respawnTick = tick + RESPAWN_TICKS;
    const airborne = !target.state.player.grounded && target.airborneSinceTick !== 0 &&
      tick - target.airborneSinceTick > 0.5 / TICK_DT;
    const actualSuicide = suicide || attackerId === target.id;
    const attacker = this.players.get(attackerId);
    const posthumous = (flags & EventFlags.Posthumous) !== 0;
    this.rules.recordKill({
      attackerId,
      victimId: target.id,
      melee: weapon.kind === "melee",
      suicide: actualSuicide,
      posthumous,
    }, tick);
    this.syncRuleState();
    const killFlags = flags |
      (actualSuicide ? EventFlags.Suicide : 0) |
      (weapon.kind === "melee" ? EventFlags.Melee : 0);
    this.broadcastEvent({
      id: this.nextEvent(), tick, kind: EventKind.Kill,
      actorId: actualSuicide ? target.id : attackerId,
      targetId: target.id, amount: 0, weaponId: weapon.id, flags: killFlags,
    });
    if (airborne && !actualSuicide && attacker !== undefined) {
      this.broadcastEvent({
        id: this.nextEvent(), tick, kind: EventKind.Airshot,
        actorId: attackerId, targetId: target.id, amount: 0,
        weaponId: weapon.id, flags: killFlags,
      });
    }
  }

  private respawnReady(tick: number): void {
    for (const slot of this.players.values()) {
      if (slot.alive || tick < slot.respawnTick || this.rules.frozen) continue;
      this.respawn(slot, tick, false);
    }
  }

  private respawn(slot: PlayerSlot, tick: number, forceGeneration: boolean): void {
    if (!forceGeneration && slot.alive) return;
    slot.generation = (slot.generation + 1) & 0xffff;
    slot.health = MAX_HEALTH;
    slot.alive = true;
    slot.respawnTick = 0;
    slot.nextFireTick = tick;
    slot.reloadTick = 0;
    slot.airborneSinceTick = 0;
    const spawn = this.spawnFor(slot.id, slot.team, slot.generation);
    const initial = createInitialState(`player-${slot.id}`);
    slot.state = {
      ...initial,
      tick,
      player: {
        ...initial.player,
        ...(spawn === undefined ? {} : { position: { ...spawn.position }, viewYaw: spawn.yaw * 180 / Math.PI }),
      },
    };
    slot.ammo = initialAmmo(this.weaponForTier(slot.tier));
  }

  private restartRound(tick: number): void {
    if (
      this.config.mode === GameMode.GunGame &&
      this.config.mapPreference === MapPreference.AutoRotate &&
      this.mapRotation.length > 1
    ) {
      this.mapRotationIndex = (this.mapRotationIndex + 1) % this.mapRotation.length;
      const next = this.mapRotation[this.mapRotationIndex];
      if (next !== undefined) {
        this.activeMapId = next.mapId;
        this.world = next.world;
        this.spawns = next.spawns;
        this.secrets = next.secrets;
      }
    }
    this.rules.restart();
    this.secretTriggered = false;
    this.syncRuleState();
    for (const projectile of this.projectiles.projectiles) this.projectiles.delete(projectile.id);
    for (const slot of this.players.values()) this.respawn(slot, tick, true);
  }

  private syncRuleState(): void {
    for (const player of this.rules.players.values()) {
      const slot = this.players.get(player.id);
      if (slot === undefined) continue;
      const oldTier = slot.tier;
      slot.tier = player.tier;
      slot.team = player.team;
      slot.kills = player.kills;
      slot.deaths = player.deaths;
      if (oldTier !== slot.tier) {
        slot.ammo = initialAmmo(this.weaponForTier(slot.tier));
        slot.reloadTick = 0;
      }
    }
  }

  private tryTriggerSecret(slot: PlayerSlot, cmd: CmdFrame, eye: Vec3, tick: number): void {
    if (this.secretTriggered || this.config.mode !== GameMode.GunGame) return;
    const direction = fireDirection(cmd.viewYaw, cmd.viewPitch);
    const end = {
      x: eye.x + direction.x * WEAPONS[WeaponId.Knife].range,
      y: eye.y + direction.y * WEAPONS[WeaponId.Knife].range,
      z: eye.z + direction.z * WEAPONS[WeaponId.Knife].range,
    };
    const sigil = this.secrets.find((secret) =>
      secret.kind === MapSecretKind.FoundrySigil && segmentIntersectsAabb(eye, end, secret.bounds));
    if (sigil === undefined) return;
    this.secretTriggered = true;
    this.broadcastEvent({
      id: this.nextEvent(),
      tick,
      kind: EventKind.SecretTriggered,
      actorId: slot.id,
      targetId: 0,
      amount: 0,
      weaponId: WeaponId.Knife,
      flags: EventFlags.Melee,
    });
  }

  private spawnFor(id: number, team: number, generation: number): MapSpawn | undefined {
    const modeSpawns = this.spawns.filter((spawn) => spawn.mode === this.config.mode);
    const pool = (modeSpawns.length === 0 ? this.spawns : modeSpawns)
      .filter((spawn) => team === 0 || spawn.team === 0 || spawn.team === team);
    const fallback = modeSpawns.length === 0 ? this.spawns : modeSpawns;
    const candidates = pool.length === 0 ? fallback : pool;
    return candidates[(id + generation - 2) % Math.max(1, candidates.length)];
  }

  private modeState(tick: number): SnapshotModeState {
    const snapshot = this.rules.snapshot;
    return {
      mode: this.config.mode,
      ladder: this.config.ladder,
      mapId: this.activeMapId,
      roundState: this.rules.frozen ? RoundState.ScoreboardFreeze : RoundState.Playing,
      winnerId: snapshot.winnerId,
      restartTicksRemaining: snapshot.restartTick === 0
        ? 0
        : clampU16(Math.max(0, snapshot.restartTick - tick)),
      teamScores: [snapshot.teamScores[0], snapshot.teamScores[1]],
      scoreboard: [...this.players.values()]
        .sort((left, right) => right.kills - left.kills || left.deaths - right.deaths || left.id - right.id)
        .map((slot) => ({
          playerId: slot.id,
          kills: clampU16(slot.kills),
          deaths: clampU16(slot.deaths),
          team: slot.team,
          tier: slot.tier,
        })),
    };
  }

  private entities(): readonly EntityState[] {
    return [
      ...[...this.players.values()].map(playerEntity),
      ...this.projectiles.projectiles.map(projectileEntity),
    ].sort((left, right) => left.id - right.id);
  }

  private sendSnapshots(serverTick: number): void {
    const entities = this.entities();
    const modeState = this.modeState(serverTick);
    for (const slot of this.players.values()) {
      if (slot.peer === undefined) continue;
      slot.snapshots.set(serverTick, entities);
      slot.sentSnapshotTicks.push(serverTick);
      if (slot.epochs.deltasSuspended) continue;
      const baseline = slot.snapshots.get(slot.ackedSnapshotTick) ?? [];
      const packed = packSnapshot({
        tick: serverTick,
        lastProcessedCmdSeq: slot.cmdWindow.lastProcessedCmdSeq,
        cmdArrivalMargin: Math.max(-128, Math.min(127, slot.cmdWindow.size - 2)),
        baselineEpoch: slot.epochs.epoch,
        baselineTick: slot.ackedSnapshotTick,
        selfId: slot.id,
        entities,
        baselineEntities: baseline,
        events: slot.events.pendingAfter(slot.ackedSnapshotTick),
        modeState,
      });
      if (packed.promotedToFull) slot.peer.sendBaseline(this.openBaseline(slot.id, serverTick));
      else slot.peer.sendSnapshot(packed.bytes);
    }
  }

  private broadcastEvent(event: SnapshotEvent): void {
    for (const slot of this.players.values()) slot.events.add(event);
  }

  private nextEvent(): number {
    const id = this.nextEventId;
    this.nextEventId = this.nextEventId >= 0xffff_ffff ? 1 : this.nextEventId + 1;
    return id;
  }

  private removePlayer(id: number): void {
    this.players.delete(id);
    this.rules.removePlayer(id);
    this.syncRuleState();
  }

  private kickAfk(nowMs: number): void {
    for (const slot of [...this.players.values()]) {
      const backgroundExpired = slot.backgroundSinceMs !== 0 &&
        nowMs - slot.backgroundSinceMs >= AFK_MS;
      const droughtExpired = slot.backgroundSinceMs === 0 && nowMs - slot.lastInputMs >= AFK_MS;
      if (!backgroundExpired && !droughtExpired) continue;
      slot.peer?.disconnect(4004, "afk");
      this.removePlayer(slot.id);
    }
  }

  private expireHolds(nowMs: number): void {
    for (const slot of [...this.players.values()]) {
      if (slot.peer === undefined && slot.holdUntilMs <= nowMs) this.removePlayer(slot.id);
    }
  }
}

export interface RoomMapBinding {
  readonly mapId: typeof MapId[keyof typeof MapId];
  readonly world: CollisionWorld | undefined;
  readonly spawns: readonly MapSpawn[];
  readonly secrets: readonly MapSecret[];
}

export interface RoomMapCatalog {
  readonly gunGame: readonly RoomMapBinding[];
  readonly scoutzknivez: RoomMapBinding;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private roomSequence = 1;
  private readonly world: CollisionWorld | undefined;
  private readonly admissionBlocked: () => boolean;
  private readonly spawns: readonly (MapSpawn | Vec3)[];
  private readonly maps: RoomMapCatalog | undefined;

  constructor(
    worldOrMaps: CollisionWorld | RoomMapCatalog | undefined,
    admissionBlocked: () => boolean,
    spawns: readonly (MapSpawn | Vec3)[] = [],
  ) {
    if (worldOrMaps !== undefined && "gunGame" in worldOrMaps) {
      this.maps = worldOrMaps;
      this.world = undefined;
      this.spawns = [];
    } else {
      this.maps = undefined;
      this.world = worldOrMaps;
      this.spawns = spawns;
    }
    this.admissionBlocked = admissionBlocked;
  }

  join(hello: HelloFrame, peer: PlayerPeer, nowMs: number): JoinResult {
    if (hello.joinKind === JoinKind.Resume && hello.reconnectToken.length === 16) {
      const requested = this.rooms.get(hello.roomId);
      const resumed = requested?.resume(hello.reconnectToken, peer, nowMs);
      if (resumed !== undefined) return resumed;
      if (requested !== undefined) return this.freshJoin(requested, hello, peer, nowMs);
    }
    if (hello.joinKind === JoinKind.Invite || hello.joinKind === JoinKind.Resume) {
      const room = this.rooms.get(hello.roomId);
      if (room === undefined) return { refusal: "room-not-found" };
      return this.freshJoin(room, hello, peer, nowMs);
    }
    if (validatePlayerName(hello.name) === undefined) return { refusal: "invalid-name" };
    if (hello.joinKind === JoinKind.Create) {
      if (this.admissionBlocked()) return { refusal: "room-create-refused" };
      const room = this.create({
        mode: hello.mode === GameMode.Scoutzknivez ? GameMode.Scoutzknivez : GameMode.GunGame,
        variant: hello.variant === GravityVariant.Scoutz ? GravityVariant.Scoutz : GravityVariant.Standard,
        ladder: hello.ladder === Ladder.Arsenal ? Ladder.Arsenal : Ladder.Classic,
        mapPreference: this.normalizeMapPreference(hello.mode, hello.mapPreference),
      }, nowMs);
      return room.add(peer, nowMs, hello.name) ?? { refusal: "room-full" };
    }
    const candidates = [...this.rooms.values()]
      .filter((room) => !room.isFull)
      .sort((left, right) => right.connectedCount - left.connectedCount);
    let room = candidates[0];
    if (room === undefined) {
      if (this.admissionBlocked()) return { refusal: "room-create-refused" };
      room = this.create({
        mode: GameMode.GunGame,
        variant: GravityVariant.Standard,
        ladder: Ladder.Classic,
        mapPreference: MapPreference.AutoRotate,
      }, nowMs);
    }
    return room.add(peer, nowMs, hello.name) ?? { refusal: "room-full" };
  }

  tick(serverTick: number, nowMs: number): void {
    for (const [id, room] of this.rooms) {
      room.tick(serverTick, nowMs);
      if (room.shouldReap(nowMs)) this.rooms.delete(id);
    }
  }

  private freshJoin(room: Room, hello: HelloFrame, peer: PlayerPeer, nowMs: number): JoinResult {
    if (validatePlayerName(hello.name) === undefined) return { refusal: "invalid-name" };
    return room.add(peer, nowMs, hello.name) ?? { refusal: "room-full" };
  }

  private create(config: RoomConfig, nowMs: number): Room {
    const id = `r${this.roomSequence.toString(36).padStart(6, "0")}`;
    this.roomSequence += 1;
    const rotation = config.mode === GameMode.Scoutzknivez
      ? (this.maps === undefined ? [] : [this.maps.scoutzknivez])
      : (this.maps?.gunGame ?? []);
    const requestedMapId = this.mapIdForPreference(config.mode, config.mapPreference);
    const binding = rotation.find((entry) => entry.mapId === requestedMapId) ?? rotation[0];
    const room = new Room(
      id,
      config,
      binding?.world ?? this.world,
      nowMs,
      binding?.spawns ?? this.spawns,
      binding?.secrets ?? [],
      binding?.mapId ?? requestedMapId,
      rotation,
    );
    this.rooms.set(id, room);
    return room;
  }

  private normalizeMapPreference(
    mode: number,
    preference: number,
  ): typeof MapPreference[keyof typeof MapPreference] {
    if (mode === GameMode.Scoutzknivez) {
      return preference === MapPreference.Spire ? MapPreference.Spire : MapPreference.AutoRotate;
    }
    return preference === MapPreference.Foundry || preference === MapPreference.Duna ||
      preference === MapPreference.Cascade
      ? preference
      : MapPreference.AutoRotate;
  }

  private mapIdForPreference(
    mode: typeof GameMode[keyof typeof GameMode],
    preference: typeof MapPreference[keyof typeof MapPreference],
  ): typeof MapId[keyof typeof MapId] {
    if (mode === GameMode.Scoutzknivez) return MapId.Spire;
    if (preference === MapPreference.Duna) return MapId.Duna;
    if (preference === MapPreference.Cascade) return MapId.Cascade;
    return MapId.Foundry;
  }
}
