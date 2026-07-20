import {
  ClientBaselineEpochs,
  ConnectionFsm,
  EventJournal,
  FrameType,
  GameMode,
  GravityVariant,
  JoinKind,
  Ladder,
  MapId,
  MapPreference,
  EntityKind,
  PROTOCOL_VERSION,
  RefusalCode,
  decodeFrame,
  encodeFrame,
  type CmdFrame,
  type EntityDelta,
  type EntityState,
  type HelloFrame,
  type SnapshotFrame,
  type SnapshotEvent,
} from "@gungame/protocol";
import type { Cmd } from "@gungame/sim";

import { WebSocketNetChannel, type NetChannel } from "./channel.js";
import { ClockSync } from "./clock.js";
import { RemoteInterpolation, type InterpolatedEntity } from "./interpolation.js";
import { roomIdFromUrl } from "../room-url.js";

export interface NetworkSnapshot {
  readonly frame: SnapshotFrame;
  readonly entities: readonly EntityState[];
  readonly resetPrediction: boolean;
  readonly events: readonly SnapshotEvent[];
}

export interface NetworkSessionOptions {
  readonly url?: string;
  readonly onSnapshot: (snapshot: NetworkSnapshot) => void;
  readonly onRefusal?: (code: number) => void;
  readonly onClose?: (code: number, reason: string) => void;
  readonly onWelcome?: (
    mode: typeof GameMode[keyof typeof GameMode],
    variant: typeof GravityVariant[keyof typeof GravityVariant],
    ladder: typeof Ladder[keyof typeof Ladder],
    mapId: typeof MapId[keyof typeof MapId],
    roomId: string,
  ) => void;
}

export function webSocketCloseForensics(
  code: number,
  reason: string,
): { readonly consoleMessage: string; readonly telemetry: string } {
  const cleanReason = reason.trim() === "" ? "no reason" : reason.trim();
  return {
    consoleMessage: `websocket closed · code ${code} · ${cleanReason}`,
    telemetry: `ws ${code} · ${cleanReason.toLowerCase()}`,
  };
}

export function surfaceWebSocketClose(
  target: Pick<HTMLElement, "dataset">,
  code: number,
  reason: string,
): string {
  const telemetry = webSocketCloseForensics(code, reason).telemetry;
  target.dataset.lastClose = telemetry;
  return telemetry;
}

function defaultUrl(): string {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return "ws://localhost:8787/gg/ws";
  }
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/gg/ws`;
}

function bytesToHex(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}

function hexToBytes(value: string | null): Uint8Array {
  if (value === null || !/^[0-9a-f]{32}$/i.test(value)) return new Uint8Array();
  return Uint8Array.from(
    Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)),
  );
}

export interface JoinHelloLocation {
  readonly pathname: string;
  readonly search: string;
  readonly buildHash: string;
  readonly storedReconnectToken: string | null;
}

export function createJoinHello(source: JoinHelloLocation): HelloFrame {
  const query = new URLSearchParams(source.search);
  const requestedRoomId = roomIdFromUrl(source.pathname, source.search);
  const create = query.get("create") === "1";
  const explicitLegacyInvite = (query.get("room") ?? "") !== "";
  const reconnectToken = create || explicitLegacyInvite || requestedRoomId === ""
    ? new Uint8Array()
    : hexToBytes(source.storedReconnectToken);
  const roomId = create ? "" : requestedRoomId;
  const mode = query.get("mode") === "scoutz"
    ? GameMode.Scoutzknivez
    : GameMode.GunGame;
  const variant = query.get("gravity") === "scoutz"
    ? GravityVariant.Scoutz
    : GravityVariant.Standard;
  const ladder = query.get("ladder") === "arsenal" ? Ladder.Arsenal : Ladder.Classic;
  const mapPreference = query.get("map") === "spire"
    ? MapPreference.Spire
    : query.get("map") === "foundry"
      ? MapPreference.Foundry
      : query.get("map") === "duna"
        ? MapPreference.Duna
        : query.get("map") === "cascade"
          ? MapPreference.Cascade
          : MapPreference.AutoRotate;
  const name = (query.get("name") ?? localStorage.getItem("gg:name") ?? "").slice(0, 16);
  return {
    type: FrameType.Hello,
    protocolVersion: PROTOCOL_VERSION,
    buildHash: source.buildHash,
    joinKind: create
      ? JoinKind.Create
      : explicitLegacyInvite
        ? JoinKind.Invite
        : reconnectToken.length === 16
          ? JoinKind.Resume
          : roomId !== ""
            ? JoinKind.Invite
            : JoinKind.Quickplay,
    mode,
    variant,
    ladder,
    mapPreference,
    name,
    roomId,
    reconnectToken,
  };
}

function joinHello(): HelloFrame {
  const roomId = roomIdFromUrl(location.pathname, location.search);
  return createJoinHello({
    pathname: location.pathname,
    search: location.search,
    buildHash: __BUILD_HASH__,
    storedReconnectToken: sessionStorage.getItem(`gg:reconnect:${roomId}`),
  });
}

function applyDelta(current: Map<number, EntityState>, delta: EntityDelta): void {
  if (delta.delete === true) {
    const existing = current.get(delta.id);
    if (existing?.generation === delta.generation) current.delete(delta.id);
    return;
  }
  const existing = current.get(delta.id);
  if (existing !== undefined && existing.generation !== delta.generation && delta.create !== true) {
    return;
  }
  if (delta.create === true) {
    if (
      delta.position === undefined ||
      delta.velocity === undefined ||
      delta.kind === undefined ||
      (delta.kind === EntityKind.Player && (
        delta.viewYaw === undefined || delta.viewPitch === undefined ||
        delta.grounded === undefined || delta.alive === undefined ||
        delta.health === undefined || delta.weaponTier === undefined || delta.ammo === undefined
      )) ||
      (delta.kind === EntityKind.Projectile && (
        delta.ownerId === undefined || delta.fireCmdSeq === undefined || delta.weaponId === undefined
      ))
    ) {
      return;
    }
    current.set(delta.id, {
      id: delta.id,
      generation: delta.generation,
      position: delta.position,
      velocity: delta.velocity,
      viewYaw: delta.viewYaw ?? 0,
      viewPitch: delta.viewPitch ?? 0,
      grounded: delta.grounded ?? false,
      alive: delta.alive ?? true,
      ducked: delta.ducked ?? false,
      kind: delta.kind,
      health: delta.health ?? 0,
      weaponTier: delta.weaponTier ?? 0,
      ammo: delta.ammo ?? 0,
      ownerId: delta.ownerId ?? 0,
      fireCmdSeq: delta.fireCmdSeq ?? 0,
      weaponId: delta.weaponId ?? 0,
    });
    return;
  }
  if (existing === undefined) return;
  current.set(delta.id, {
    ...existing,
    ...(delta.position === undefined ? {} : { position: delta.position }),
    ...(delta.velocity === undefined ? {} : { velocity: delta.velocity }),
    ...(delta.viewYaw === undefined ? {} : { viewYaw: delta.viewYaw }),
    ...(delta.viewPitch === undefined ? {} : { viewPitch: delta.viewPitch }),
    ...(delta.grounded === undefined ? {} : { grounded: delta.grounded }),
    ...(delta.alive === undefined ? {} : { alive: delta.alive }),
    ...(delta.ducked === undefined ? {} : { ducked: delta.ducked }),
    ...(delta.kind === undefined ? {} : { kind: delta.kind }),
    ...(delta.health === undefined ? {} : { health: delta.health }),
    ...(delta.weaponTier === undefined ? {} : { weaponTier: delta.weaponTier }),
    ...(delta.ammo === undefined ? {} : { ammo: delta.ammo }),
    ...(delta.ownerId === undefined ? {} : { ownerId: delta.ownerId }),
    ...(delta.fireCmdSeq === undefined ? {} : { fireCmdSeq: delta.fireCmdSeq }),
    ...(delta.weaponId === undefined ? {} : { weaponId: delta.weaponId }),
  });
}

export class NetworkSession {
  readonly clock = new ClockSync();
  readonly interpolation = new RemoteInterpolation("ws");
  private readonly channel: NetChannel;
  private readonly fsm = new ConnectionFsm(performance.now());
  private readonly epochs = new ClientBaselineEpochs();
  private readonly events = new EventJournal();
  private readonly entities = new Map<number, EntityState>();
  private readonly onSnapshot: NetworkSessionOptions["onSnapshot"];
  private readonly onRefusal: ((code: number) => void) | undefined;
  private readonly onClose: ((code: number, reason: string) => void) | undefined;
  private readonly onWelcome: NetworkSessionOptions["onWelcome"];
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private pingNonce = 1;
  private playerId = 0;
  private roomId = "";
  private latestTick = 0;
  private arrivalMargin = 0;

  constructor(options: NetworkSessionOptions) {
    this.onSnapshot = options.onSnapshot;
    this.onRefusal = options.onRefusal;
    this.onClose = options.onClose;
    this.onWelcome = options.onWelcome;
    this.channel = new WebSocketNetChannel(options.url ?? defaultUrl(), {
      open: () => this.open(),
      message: (payload) => this.message(payload),
      close: (code, reason) => this.closed(code, reason),
      error: () => {},
    });
  }

  get selfId(): number {
    return this.playerId;
  }

  sendCommand(cmd: Cmd, nowMs: number): void {
    if (this.playerId === 0 || this.epochs.epoch === 0) return;
    const target = this.clock.interpolationTarget(nowMs, this.interpolation.delayTicks);
    const frame: CmdFrame = {
      type: FrameType.Cmd,
      seq: cmd.seq,
      tick: this.clock.commandTick(cmd.tick, this.arrivalMargin, nowMs),
      buttons: cmd.buttons,
      viewYaw: cmd.viewYaw,
      viewPitch: cmd.viewPitch,
      fireFraction: cmd.fireFraction,
      lastSnapshotTick: this.latestTick,
      interpTargetTick: target.tick,
      interpTargetFraction: target.fraction,
      baselineEpoch: this.epochs.epoch,
    };
    this.channel.send(encodeFrame(frame), "latest");
  }

  remoteEntities(nowMs: number): readonly InterpolatedEntity[] {
    const target = this.clock.interpolationTarget(nowMs, this.interpolation.delayTicks);
    const entities = this.interpolation.sample(target.tick, target.fraction);
    // Feed the adaptive-delay controller: widen the buffer when we ran dry,
    // decay back toward the base delay when snapshots are flowing again. (F1)
    this.interpolation.noteStall(this.interpolation.lastSampleStalled);
    return entities;
  }

  close(): void {
    if (this.pingTimer !== undefined) clearInterval(this.pingTimer);
    this.channel.close();
  }

  private open(): void {
    const now = performance.now();
    this.fsm.transition("hello", now);
    this.channel.send(encodeFrame(joinHello()), "reliable");
    this.pingTimer = setInterval(() => {
      const clientTime = performance.now();
      this.channel.send(encodeFrame({
        type: FrameType.Ping,
        nonce: this.pingNonce,
        clientTime,
      }), "reliable");
      this.pingNonce += 1;
    }, 1_000);
  }

  private message(payload: Uint8Array): void {
    try {
      const frame = decodeFrame(payload);
      const now = performance.now();
      if (frame.type === FrameType.Welcome) {
        this.playerId = frame.playerId;
        this.roomId = frame.roomId;
        sessionStorage.setItem(`gg:reconnect:${frame.roomId}`, bytesToHex(frame.reconnectToken));
        this.onWelcome?.(frame.mode, frame.variant, frame.ladder, frame.mapId, frame.roomId);
        this.fsm.transition("baseline-install", now);
        return;
      }
      if (frame.type === FrameType.Refusal) {
        if (frame.code === RefusalCode.VersionMismatch) console.error("client build mismatch");
        this.onRefusal?.(frame.code);
        return;
      }
      if (frame.type === FrameType.Pong) {
        this.clock.observePong(frame.clientTime, now);
        return;
      }
      if (frame.type !== FrameType.Snapshot) return;
      this.clock.observeServerTick(frame.tick, now);
      this.arrivalMargin = frame.cmdArrivalMargin;
      const resetPrediction = frame.full;
      if (frame.full) {
        if (this.fsm.state === "active") this.fsm.transition("resync", now);
        this.epochs.installFull(frame.baselineEpoch);
        this.entities.clear();
      } else if (this.epochs.classifyTraffic(frame.baselineEpoch) === "valid-stale") {
        return;
      }
      for (const delta of frame.entities) applyDelta(this.entities, delta);
      const events = this.events.dedupe(frame.events);
      this.latestTick = Math.max(this.latestTick, frame.tick);
      const entityValues = [...this.entities.values()];
      this.interpolation.push(frame.tick, entityValues, this.playerId);
      this.onSnapshot({ frame, entities: entityValues, resetPrediction, events });
      if (frame.full) {
        this.channel.send(encodeFrame({
          type: FrameType.BaselineAck,
          baselineEpoch: frame.baselineEpoch,
          snapshotTick: frame.tick,
        }), "reliable");
        if (this.fsm.state === "baseline-install" || this.fsm.state === "resync") {
          this.fsm.transition("active", now);
        }
        this.epochs.finishResync();
      }
    } catch (error) {
      console.error("network frame rejected", error);
      this.channel.close(4002, "protocol error");
    }
  }

  private closed(code: number, reason: string): void {
    if (this.pingTimer !== undefined) clearInterval(this.pingTimer);
    console.warn(webSocketCloseForensics(code, reason).consoleMessage);
    if (this.fsm.state !== "closing") {
      try {
        this.fsm.transition("closing", performance.now());
      } catch {
        // Already terminal after an invalid peer transition.
      }
    }
    this.onClose?.(code, reason);
  }
}
