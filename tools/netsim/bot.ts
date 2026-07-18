import {
  ClientBaselineEpochs,
  FrameType,
  GameMode,
  GravityVariant,
  JoinKind,
  PROTOCOL_VERSION,
  decodeFrame,
  encodeFrame,
  type EntityDelta,
  type EntityState,
  type SnapshotFrame,
} from "@gungame/protocol";
import { TICK_DT } from "@gungame/shared";
import {
  Buttons,
  DEFAULT,
  createInitialState,
  step,
  type Cmd,
  type CollisionWorld,
  type State,
} from "@gungame/sim";

const TICK_MS = TICK_DT * 1_000;

export interface BotMetrics {
  readonly corrections: readonly number[];
  readonly remoteStallsMs: readonly number[];
  readonly snapshotBytes: readonly number[];
  readonly reconnectCount: number;
  readonly protocolErrors: number;
  readonly sawRemoteMovement: boolean;
  readonly snapshots: number;
}

export interface BotOptions {
  readonly id: number;
  readonly url: string;
  readonly world?: CollisionWorld;
  readonly seed: number;
}

function applyDelta(current: Map<number, EntityState>, delta: EntityDelta): void {
  if (delta.delete === true) {
    if (current.get(delta.id)?.generation === delta.generation) current.delete(delta.id);
    return;
  }
  if (delta.create === true) {
    if (
      delta.position === undefined ||
      delta.velocity === undefined ||
      delta.viewYaw === undefined ||
      delta.viewPitch === undefined ||
      delta.grounded === undefined ||
      delta.alive === undefined
    ) return;
    current.set(delta.id, {
      id: delta.id,
      generation: delta.generation,
      position: delta.position,
      velocity: delta.velocity,
      viewYaw: delta.viewYaw,
      viewPitch: delta.viewPitch,
      grounded: delta.grounded,
      alive: delta.alive,
    });
    return;
  }
  const previous = current.get(delta.id);
  if (previous === undefined || previous.generation !== delta.generation) return;
  current.set(delta.id, {
    ...previous,
    ...(delta.position === undefined ? {} : { position: delta.position }),
    ...(delta.velocity === undefined ? {} : { velocity: delta.velocity }),
    ...(delta.viewYaw === undefined ? {} : { viewYaw: delta.viewYaw }),
    ...(delta.viewPitch === undefined ? {} : { viewPitch: delta.viewPitch }),
    ...(delta.grounded === undefined ? {} : { grounded: delta.grounded }),
    ...(delta.alive === undefined ? {} : { alive: delta.alive }),
  });
}

function distance(a: State, b: State): number {
  return Math.hypot(
    a.player.position.x - b.player.position.x,
    a.player.position.y - b.player.position.y,
    a.player.position.z - b.player.position.z,
  );
}

export class HeadlessBot {
  private readonly options: BotOptions;
  private socket: WebSocket | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private resolveReady: (() => void) | undefined;
  private readonly readyPromise: Promise<void>;
  private readonly epochs = new ClientBaselineEpochs();
  private readonly entities = new Map<number, EntityState>();
  private readonly unacked: Cmd[] = [];
  private predicted: State | undefined;
  private seq = 1;
  private playerId = 0;
  private roomId = "";
  private reconnectToken: Uint8Array = new Uint8Array();
  private latestSnapshotTick = 0;
  private stopped = false;
  private lastSnapshotAtMs = 0;
  private lastRemotePositions = new Map<number, EntityState["position"]>();
  private corrections: number[] = [];
  private remoteStallsMs: number[] = [];
  private snapshotBytes: number[] = [];
  private reconnects = 0;
  private protocolErrors = 0;
  private sawMovement = false;

  constructor(options: BotOptions) {
    this.options = options;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  get ready(): Promise<void> {
    return this.readyPromise;
  }

  start(): void {
    this.connect(false);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.socket?.close(1_000, "done");
  }

  metrics(): BotMetrics {
    return {
      corrections: this.corrections.slice(),
      remoteStallsMs: this.remoteStallsMs.slice(),
      snapshotBytes: this.snapshotBytes.slice(),
      reconnectCount: this.reconnects,
      protocolErrors: this.protocolErrors,
      sawRemoteMovement: this.sawMovement,
      snapshots: this.snapshotBytes.length,
    };
  }

  private connect(resume: boolean): void {
    const socket = new WebSocket(this.options.url, "gungame-bot");
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", () => {
      socket.send(encodeFrame({
        type: FrameType.Hello,
        protocolVersion: PROTOCOL_VERSION,
        buildHash: "dev",
        joinKind: resume ? JoinKind.Resume : JoinKind.Quickplay,
        mode: GameMode.GunGame,
        variant: GravityVariant.Standard,
        roomId: resume ? this.roomId : "",
        reconnectToken: resume ? this.reconnectToken : new Uint8Array(),
      }));
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) this.receive(new Uint8Array(event.data));
    });
    socket.addEventListener("close", () => {
      if (this.timer !== undefined) clearInterval(this.timer);
      this.timer = undefined;
      if (!this.stopped && this.reconnectToken.length === 16) {
        this.reconnects += 1;
        setTimeout(() => this.connect(true), 100);
      }
    });
    socket.addEventListener("error", () => {});
  }

  private receive(bytes: Uint8Array): void {
    try {
      const frame = decodeFrame(bytes);
      if (frame.type === FrameType.Refusal) {
        this.protocolErrors += 1;
        return;
      }
      if (frame.type === FrameType.Welcome) {
        this.playerId = frame.playerId;
        this.roomId = frame.roomId;
        this.reconnectToken = frame.reconnectToken;
        return;
      }
      if (frame.type !== FrameType.Snapshot) return;
      this.snapshotBytes.push(bytes.length);
      const now = performance.now();
      if (this.lastSnapshotAtMs !== 0) {
        this.remoteStallsMs.push(Math.max(0, now - this.lastSnapshotAtMs - TICK_MS));
      }
      this.lastSnapshotAtMs = now;
      this.applySnapshot(frame);
    } catch {
      this.protocolErrors += 1;
    }
  }

  private applySnapshot(frame: SnapshotFrame): void {
    if (frame.full) {
      this.epochs.installFull(frame.baselineEpoch);
      this.entities.clear();
    } else {
      this.epochs.classifyTraffic(frame.baselineEpoch);
    }
    for (const delta of frame.entities) applyDelta(this.entities, delta);
    this.latestSnapshotTick = Math.max(this.latestSnapshotTick, frame.tick);
    if (frame.full) {
      this.socket?.send(encodeFrame({
        type: FrameType.BaselineAck,
        baselineEpoch: frame.baselineEpoch,
        snapshotTick: frame.tick,
      }));
      this.epochs.finishResync();
    }
    const self = this.entities.get(this.playerId);
    if (self !== undefined) {
      const authoritative: State = {
        tick: frame.tick,
        player: {
          ...(this.predicted?.player ?? createInitialState(`bot-${this.options.id}`).player),
          position: self.position,
          velocity: self.velocity,
          viewYaw: self.viewYaw,
          viewPitch: self.viewPitch,
          grounded: self.grounded,
        },
      };
      while ((this.unacked[0]?.seq ?? Infinity) <= frame.lastProcessedCmdSeq) {
        this.unacked.shift();
      }
      let rebuilt = authoritative;
      for (const cmd of this.unacked) {
        rebuilt = step(
          rebuilt,
          cmd,
          TICK_DT,
          this.options.world === undefined
            ? { params: DEFAULT }
            : { params: DEFAULT, world: this.options.world },
        );
      }
      if (this.predicted !== undefined) this.corrections.push(distance(this.predicted, rebuilt));
      this.predicted = rebuilt;
    }
    for (const remote of this.entities.values()) {
      if (remote.id === this.playerId) continue;
      const previous = this.lastRemotePositions.get(remote.id);
      if (
        previous !== undefined &&
        Math.hypot(
          previous.x - remote.position.x,
          previous.y - remote.position.y,
          previous.z - remote.position.z,
        ) > 0.005
      ) {
        this.sawMovement = true;
      }
      this.lastRemotePositions.set(remote.id, remote.position);
    }
    if (this.timer === undefined) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.resolveReady?.();
      this.resolveReady = undefined;
    }
  }

  private tick(): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.epochs.epoch === 0) return;
    const phase = Math.floor((this.seq + this.options.seed) / 64) % 4;
    let buttons = Buttons.Forward;
    buttons |= phase % 2 === 0 ? Buttons.Left : Buttons.Right;
    if (this.seq % 24 === 1) buttons |= Buttons.Jump;
    const cmd: Cmd = {
      seq: this.seq,
      tick: this.predicted?.tick ?? this.seq,
      buttons,
      viewYaw: phase * 90,
      viewPitch: 0,
      fireFraction: 0,
      lastSnapshotTick: this.latestSnapshotTick,
      interpTargetTick: Math.max(0, this.latestSnapshotTick - 5),
      interpTargetFraction: 0,
    };
    this.seq += 1;
    this.unacked.push(cmd);
    if (this.predicted !== undefined) {
      this.predicted = step(
        this.predicted,
        cmd,
        TICK_DT,
        this.options.world === undefined
          ? { params: DEFAULT }
          : { params: DEFAULT, world: this.options.world },
      );
    }
    this.socket.send(encodeFrame({
      type: FrameType.Cmd,
      ...cmd,
      baselineEpoch: this.epochs.epoch,
    }));
  }
}
