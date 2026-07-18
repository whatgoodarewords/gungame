import { randomBytes } from "node:crypto";

import {
  CmdAcceptanceWindow,
  EventJournal,
  FrameType,
  GameMode,
  GravityVariant,
  JoinKind,
  ProtocolError,
  ServerBaselineEpochs,
  SnapshotRing,
  packSnapshot,
  type CmdFrame,
  type EntityState,
  type HelloFrame,
} from "@gungame/protocol";
import { TICK_DT } from "@gungame/shared";
import type { Vec3 } from "@gungame/shared";
import {
  Buttons,
  DEFAULT,
  SCOUTZ,
  createInitialState,
  step,
  type CollisionWorld,
  type Cmd,
  type State,
} from "@gungame/sim";

import { FixedRing } from "./ring.js";

const MAX_PLAYERS = 12;
const RECONNECT_HOLD_MS = 45_000;
const EMPTY_REAP_MS = 5 * 60_000;
const HULL_RING_TICKS = Math.ceil(0.4 / TICK_DT) + 1;

export interface PlayerPeer {
  sendReliable(bytes: Uint8Array): void;
  sendBaseline(bytes: Uint8Array): void;
  sendSnapshot(bytes: Uint8Array): void;
  disconnect(code: number, reason: string): void;
}

export interface RoomConfig {
  readonly mode: typeof GameMode[keyof typeof GameMode];
  readonly variant: typeof GravityVariant[keyof typeof GravityVariant];
}

export interface HullSample {
  readonly tick: number;
  readonly generation: number;
  readonly alive: boolean;
  readonly position: State["player"]["position"];
}

export interface PlayerSlot {
  readonly id: number;
  readonly cmdWindow: CmdAcceptanceWindow;
  readonly snapshots: SnapshotRing;
  readonly events: EventJournal;
  readonly epochs: ServerBaselineEpochs;
  readonly hulls: FixedRing<HullSample>;
  state: State;
  generation: number;
  alive: boolean;
  peer: PlayerPeer | undefined;
  tokenHex: string;
  token: Uint8Array;
  holdUntilMs: number;
  lastCmd: CmdFrame | undefined;
  repeatTicks: number;
  ackedSnapshotTick: number;
}

export interface JoinSuccess {
  readonly room: Room;
  readonly slot: PlayerSlot;
  readonly token: Uint8Array;
  readonly resumed: boolean;
}

export type JoinResult =
  | JoinSuccess
  | { readonly refusal: "room-full" | "room-create-refused" | "room-not-found" };

function tokenBytes(): Uint8Array {
  return new Uint8Array(randomBytes(16));
}

function tokenKey(token: Uint8Array): string {
  let result = "";
  for (const byte of token) result += byte.toString(16).padStart(2, "0");
  return result;
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

function entity(slot: PlayerSlot): EntityState {
  return {
    id: slot.id,
    generation: slot.generation,
    position: slot.state.player.position,
    velocity: slot.state.player.velocity,
    viewYaw: slot.state.player.viewYaw,
    viewPitch: slot.state.player.viewPitch,
    grounded: slot.state.player.grounded,
    alive: slot.alive,
  };
}

export class Room {
  readonly players = new Map<number, PlayerSlot>();
  readonly config: RoomConfig;
  readonly id: string;
  private nextPlayerId = 1;
  private lastNonEmptyMs: number;
  private readonly world: CollisionWorld | undefined;
  private readonly spawns: readonly Vec3[];

  constructor(
    id: string,
    config: RoomConfig,
    world: CollisionWorld | undefined,
    nowMs: number,
    spawns: readonly Vec3[] = [],
  ) {
    this.id = id;
    this.config = Object.freeze({ ...config });
    this.world = world;
    this.spawns = spawns;
    this.lastNonEmptyMs = nowMs;
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

  add(peer: PlayerPeer, nowMs: number): JoinSuccess | undefined {
    this.expireHolds(nowMs);
    if (this.isFull) return undefined;
    const id = this.nextPlayerId;
    this.nextPlayerId += 1;
    const token = tokenBytes();
    const initial = createInitialState(`player-${id}`);
    const spawn = this.spawns[(id - 1) % Math.max(1, this.spawns.length)];
    const state = spawn === undefined
      ? initial
      : { ...initial, player: { ...initial.player, position: { ...spawn } } };
    const slot: PlayerSlot = {
      id,
      state,
      generation: 1,
      alive: true,
      cmdWindow: new CmdAcceptanceWindow(),
      snapshots: new SnapshotRing(),
      events: new EventJournal(),
      epochs: new ServerBaselineEpochs(),
      hulls: new FixedRing(HULL_RING_TICKS),
      peer,
      token,
      tokenHex: tokenKey(token),
      holdUntilMs: 0,
      lastCmd: undefined,
      repeatTicks: 0,
      ackedSnapshotTick: 0,
    };
    this.players.set(id, slot);
    this.lastNonEmptyMs = nowMs;
    return { room: this, slot, token: token.slice(), resumed: false };
  }

  resume(token: Uint8Array, peer: PlayerPeer, nowMs: number): JoinSuccess | undefined {
    const key = tokenKey(token);
    for (const slot of this.players.values()) {
      if (slot.tokenHex !== key || (slot.peer === undefined && slot.holdUntilMs < nowMs)) continue;
      slot.peer?.disconnect(4001, "superseded");
      const rotated = tokenBytes();
      slot.token = rotated;
      slot.tokenHex = tokenKey(rotated);
      slot.peer = peer;
      slot.holdUntilMs = 0;
      slot.repeatTicks = 0;
      this.lastNonEmptyMs = nowMs;
      return { room: this, slot, token: rotated.slice(), resumed: true };
    }
    return undefined;
  }

  disconnect(slotId: number, nowMs: number): void {
    const slot = this.players.get(slotId);
    if (slot === undefined) return;
    slot.peer = undefined;
    slot.holdUntilMs = nowMs + RECONNECT_HOLD_MS;
    if (this.connectedCount === 0) this.lastNonEmptyMs = nowMs;
  }

  acceptCmd(slotId: number, cmd: CmdFrame): boolean {
    const slot = this.players.get(slotId);
    return slot?.cmdWindow.accept(cmd) ?? false;
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
    const epoch = slot.epochs.openFull(tick);
    const packed = packSnapshot({
      tick,
      lastProcessedCmdSeq: slot.cmdWindow.lastProcessedCmdSeq,
      cmdArrivalMargin: slot.cmdWindow.size - 2,
      baselineEpoch: epoch,
      baselineTick: tick,
      selfId: slot.id,
      entities,
      baselineEntities: [],
      events: slot.events.pendingAfter(0),
      forceFull: true,
    });
    return packed.bytes;
  }

  tick(serverTick: number, nowMs: number): void {
    this.expireHolds(nowMs);
    for (const slot of this.players.values()) {
      let cmd: Cmd | undefined;
      try {
        const consumed = slot.cmdWindow.consume((epoch) => slot.epochs.classifyReference(epoch));
        if (consumed !== undefined) {
          slot.lastCmd = consumed.cmd;
          slot.repeatTicks = 0;
          cmd = toSimCmd(consumed.cmd);
          if (
            consumed.epochReference === "current" &&
            consumed.cmd.lastSnapshotTick > slot.ackedSnapshotTick
          ) {
            if (slot.snapshots.has(consumed.cmd.lastSnapshotTick)) {
              slot.ackedSnapshotTick = consumed.cmd.lastSnapshotTick;
              slot.events.acknowledgeBaseline(consumed.cmd.lastSnapshotTick);
            } else if (!slot.epochs.deltasSuspended) {
              slot.peer?.sendBaseline(this.openBaseline(slot.id, serverTick));
            }
          }
        } else if (slot.lastCmd !== undefined && slot.repeatTicks < 8) {
          slot.repeatTicks += 1;
          cmd = toSimCmd(slot.lastCmd);
        } else if (slot.lastCmd !== undefined) {
          cmd = toSimCmd(slot.lastCmd, slot.lastCmd.buttons & Buttons.Duck);
        }
      } catch (error) {
        slot.peer?.disconnect(4002, error instanceof Error ? error.message : "protocol error");
        slot.peer = undefined;
      }
      if (cmd !== undefined && slot.peer !== undefined) {
        const scoutz =
          this.config.mode === GameMode.Scoutzknivez ||
          this.config.variant === GravityVariant.Scoutz;
        slot.state = step(
          slot.state,
          cmd,
          TICK_DT,
          {
            ...(this.world === undefined ? {} : { world: this.world }),
            params: scoutz ? SCOUTZ : DEFAULT,
          },
        );
      }
      slot.hulls.push({
        tick: serverTick,
        generation: slot.generation,
        alive: slot.alive,
        position: { ...slot.state.player.position },
      });
    }

    const entities = this.entities();
    for (const slot of this.players.values()) {
      if (slot.peer === undefined) continue;
      slot.snapshots.set(serverTick, entities);
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
      });
      if (packed.promotedToFull) {
        slot.peer.sendBaseline(this.openBaseline(slot.id, serverTick));
      } else {
        slot.peer.sendSnapshot(packed.bytes);
      }
    }
  }

  shouldReap(nowMs: number): boolean {
    this.expireHolds(nowMs);
    return this.players.size === 0 && nowMs - this.lastNonEmptyMs >= EMPTY_REAP_MS;
  }

  private entities(): readonly EntityState[] {
    return [...this.players.values()].map(entity).sort((a, b) => a.id - b.id);
  }

  private expireHolds(nowMs: number): void {
    for (const [id, slot] of this.players) {
      if (slot.peer === undefined && slot.holdUntilMs <= nowMs) this.players.delete(id);
    }
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private roomSequence = 1;
  private readonly world: CollisionWorld | undefined;
  private readonly admissionBlocked: () => boolean;
  private readonly spawns: readonly Vec3[];

  constructor(
    world: CollisionWorld | undefined,
    admissionBlocked: () => boolean,
    spawns: readonly Vec3[] = [],
  ) {
    this.world = world;
    this.admissionBlocked = admissionBlocked;
    this.spawns = spawns;
  }

  join(hello: HelloFrame, peer: PlayerPeer, nowMs: number): JoinResult {
    if (hello.joinKind === JoinKind.Resume && hello.reconnectToken.length === 16) {
      const requested = this.rooms.get(hello.roomId);
      const resumed = requested?.resume(hello.reconnectToken, peer, nowMs);
      if (resumed !== undefined) return resumed;
      if (requested !== undefined) {
        const fresh = requested.add(peer, nowMs);
        return fresh ?? { refusal: "room-full" };
      }
    }
    if (hello.joinKind === JoinKind.Invite || hello.joinKind === JoinKind.Resume) {
      const room = this.rooms.get(hello.roomId);
      if (room === undefined) return { refusal: "room-not-found" };
      return room.add(peer, nowMs) ?? { refusal: "room-full" };
    }
    if (hello.joinKind === JoinKind.Create) {
      if (this.admissionBlocked()) return { refusal: "room-create-refused" };
      const room = this.create({ mode: hello.mode, variant: hello.variant }, nowMs);
      return room.add(peer, nowMs) ?? { refusal: "room-full" };
    }
    const candidates = [...this.rooms.values()]
      .filter((room) => !room.isFull)
      .sort((a, b) => b.connectedCount - a.connectedCount);
    let room = candidates[0];
    if (room === undefined) {
      if (this.admissionBlocked()) return { refusal: "room-create-refused" };
      room = this.create(
        { mode: GameMode.GunGame, variant: GravityVariant.Standard },
        nowMs,
      );
    }
    return room.add(peer, nowMs) ?? { refusal: "room-full" };
  }

  tick(serverTick: number, nowMs: number): void {
    for (const [id, room] of this.rooms) {
      room.tick(serverTick, nowMs);
      if (room.shouldReap(nowMs)) this.rooms.delete(id);
    }
  }

  private create(config: RoomConfig, nowMs: number): Room {
    const id = `r${this.roomSequence.toString(36).padStart(6, "0")}`;
    this.roomSequence += 1;
    const room = new Room(id, config, this.world, nowMs, this.spawns);
    this.rooms.set(id, room);
    return room;
  }
}
