import uWS, { type HttpRequest, type WebSocket } from "uWebSockets.js";

import {
  ConnectionFsm,
  FrameType,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  RefusalCode,
  SNAPSHOT_SIZE_CEILING,
  decodeFrame,
  encodeFrame,
  type RefusalFrame,
} from "@gungame/protocol";

import { ConnectionRateLimit } from "./rate-limit.js";
import { RoomManager, type JoinResult, type PlayerPeer } from "./rooms.js";

const BACKPRESSURE_HIGH = 32 * 1_024;
const BACKPRESSURE_LOW = 8 * 1_024;
const BACKPRESSURE_HARD = 256 * 1_024;

export interface ConnectionData {
  readonly fsm: ConnectionFsm;
  readonly limiter: ConnectionRateLimit;
  peer: WsPeer | undefined;
  roomId: string;
  slotId: number;
  quarantined: boolean;
}

export type ConnectionErrorLog = (message: string, error: unknown) => void;

const defaultConnectionErrorLog: ConnectionErrorLog = (message, error) => {
  console.error(message, error);
};

function refusal(code: RefusalFrame["code"]): Uint8Array {
  return encodeFrame({ type: FrameType.Refusal, code });
}

function refusalFor(result: Exclude<JoinResult, { readonly room: unknown }>): RefusalFrame["code"] {
  switch (result.refusal) {
    case "room-full":
      return RefusalCode.RoomFull;
    case "room-create-refused":
      return RefusalCode.RoomCreateRefused;
    case "room-not-found":
      return RefusalCode.RoomNotFound;
    case "invalid-name":
      return RefusalCode.InvalidName;
  }
}

export class WsPeer implements PlayerPeer {
  private pendingSnapshot: Uint8Array | undefined;
  private aboveHigh = false;
  private ended = false;
  private readonly ws: WebSocket<ConnectionData>;
  private readonly quarantine: (error: unknown, phase: string, nowMs: number) => void;

  constructor(
    ws: WebSocket<ConnectionData>,
    quarantine: (error: unknown, phase: string, nowMs: number) => void = () => {},
  ) {
    this.ws = ws;
    this.quarantine = quarantine;
  }

  sendReliable(bytes: Uint8Array): void {
    if (this.ended) return;
    if (this.ws.getBufferedAmount() >= BACKPRESSURE_HARD) {
      this.closeForBackpressure();
      return;
    }
    this.ws.send(bytes, true, false);
  }

  sendBaseline(bytes: Uint8Array, nowMs: number): void {
    const data = this.ws.getUserData();
    if (data.fsm.state === "active") {
      try {
        data.fsm.transition("resync", nowMs);
      } catch (error) {
        this.quarantine(error, "baseline transition", nowMs);
        return;
      }
    }
    this.sendReliable(bytes);
  }

  sendSnapshot(bytes: Uint8Array): void {
    if (this.ended) return;
    const buffered = this.ws.getBufferedAmount();
    if (buffered >= BACKPRESSURE_HARD) {
      this.closeForBackpressure();
      return;
    }
    if (this.aboveHigh || buffered >= BACKPRESSURE_HIGH) {
      this.aboveHigh = true;
      this.pendingSnapshot = bytes.slice();
      return;
    }
    this.ws.send(bytes, true, false);
  }

  drain(): void {
    if (this.ended) return;
    if (this.ws.getBufferedAmount() > BACKPRESSURE_LOW) return;
    this.aboveHigh = false;
    const pending = this.pendingSnapshot;
    this.pendingSnapshot = undefined;
    if (pending !== undefined) this.ws.send(pending, true, false);
  }

  disconnect(code: number, reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.ws.end(code, reason.slice(0, 120));
  }

  private closeForBackpressure(): void {
    if (this.ended) return;
    this.ws.send(refusal(RefusalCode.Backpressure), true, false);
    this.ended = true;
    this.ws.end(4008, "backpressure");
  }
}

function allowedOrigins(): ReadonlySet<string> {
  const configured = process.env.ALLOWED_ORIGINS;
  const values = configured === undefined
    ? ["http://localhost:5173", "http://127.0.0.1:5173"]
    : configured.split(",").map((value) => value.trim()).filter(Boolean);
  return new Set(values);
}

function validUpgradeOrigin(request: HttpRequest, origins: ReadonlySet<string>): boolean {
  const origin = request.getHeader("origin");
  if (origins.has(origin)) return true;
  return (
    origin === "" &&
    process.env.ALLOW_HEADLESS_BOTS === "1" &&
    request.getHeader("sec-websocket-protocol") === "gungame-bot"
  );
}

function quarantineConnection(
  data: ConnectionData,
  nowMs: number,
  phase: string,
  error: unknown,
  log: ConnectionErrorLog,
): void {
  if (data.quarantined) return;
  data.quarantined = true;
  const detail = error instanceof Error ? error.message : String(error);
  log(
    `connection quarantined · phase ${phase} · at ${nowMs.toFixed(3)} ms · ` +
    `room ${data.roomId || "-"} · slot ${data.slotId || "-"}`,
    error,
  );
  data.peer?.sendReliable(refusal(RefusalCode.ProtocolError));
  data.peer?.disconnect(4002, `protocol state error: ${detail}`.slice(0, 120));
}

function closeProtocol(
  data: ConnectionData,
  code: RefusalFrame["code"],
  reason: string,
  nowMs: number,
  log: ConnectionErrorLog,
): void {
  try {
    data.fsm.malformed(nowMs);
    data.peer?.sendReliable(refusal(code));
    data.peer?.disconnect(4002, reason);
  } catch (error) {
    quarantineConnection(data, nowMs, "protocol close", error, log);
  }
}

export interface TransportServer {
  readonly app: uWS.TemplatedApp;
  readonly connections: ReadonlySet<ConnectionData>;
  sweepTimeouts(nowMs: number): void;
  drainForRestart(): void;
}

export function sweepConnectionTimeouts(
  connections: Iterable<ConnectionData>,
  nowMs: number,
  log: ConnectionErrorLog = defaultConnectionErrorLog,
): void {
  for (const data of connections) {
    if (data.quarantined || data.fsm.state === "closing") continue;
    try {
      if (!data.fsm.timedOut(nowMs)) continue;
      data.fsm.transition("closing", nowMs);
      data.peer?.disconnect(4000, "state timeout");
    } catch (error) {
      quarantineConnection(data, nowMs, "timeout sweep", error, log);
    }
  }
}

export function createTransport(
  manager: RoomManager,
  clock: () => number = () => performance.now(),
  log: ConnectionErrorLog = defaultConnectionErrorLog,
): TransportServer {
  const app = uWS.App();
  const origins = allowedOrigins();
  const connections = new Set<ConnectionData>();

  app.ws<ConnectionData>("/gg/ws", {
    compression: uWS.DISABLED,
    idleTimeout: 32,
    maxBackpressure: BACKPRESSURE_HARD + SNAPSHOT_SIZE_CEILING,
    maxPayloadLength: MAX_FRAME_BYTES,
    closeOnBackpressureLimit: false,
    sendPingsAutomatically: true,
    upgrade: (response, request, context) => {
      if (!validUpgradeOrigin(request, origins)) {
        response.writeStatus("403 Forbidden").end("origin denied");
        return;
      }
      const now = clock();
      response.upgrade<ConnectionData>(
        {
          fsm: new ConnectionFsm(now),
          limiter: new ConnectionRateLimit(now),
          peer: undefined,
          roomId: "",
          slotId: 0,
          quarantined: false,
        },
        request.getHeader("sec-websocket-key"),
        request.getHeader("sec-websocket-protocol"),
        request.getHeader("sec-websocket-extensions"),
        context,
      );
    },
    open: (ws) => {
      const data = ws.getUserData();
      const now = clock();
      data.peer = new WsPeer(ws, (error, phase, atMs) => {
        quarantineConnection(data, atMs, phase, error, log);
      });
      try {
        data.fsm.transition("hello", now);
      } catch (error) {
        quarantineConnection(data, now, "open", error, log);
        return;
      }
      connections.add(data);
    },
    message: (ws, raw, isBinary) => {
      const data = ws.getUserData();
      const now = clock();
      if (data.quarantined) return;
      if (!isBinary) {
        closeProtocol(data, RefusalCode.ProtocolError, "binary frames required", now, log);
        return;
      }
      if (!data.limiter.accept(raw.byteLength, now)) {
        closeProtocol(data, RefusalCode.RateLimited, "rate limit", now, log);
        return;
      }
      try {
        const frame = decodeFrame(new Uint8Array(raw));
        data.fsm.touch(now);
        if (frame.type === FrameType.Hello) {
          if (data.fsm.state !== "hello") throw new Error("unexpected hello");
          if (
            frame.protocolVersion !== PROTOCOL_VERSION ||
            frame.buildHash !== __BUILD_HASH__
          ) {
            data.peer?.sendReliable(refusal(RefusalCode.VersionMismatch));
            data.fsm.transition("closing", now);
            data.peer?.disconnect(4000, "version mismatch");
            return;
          }
          const joined = manager.join(frame, data.peer as WsPeer, now);
          if ("refusal" in joined) {
            data.peer?.sendReliable(refusal(refusalFor(joined)));
            data.fsm.transition("closing", now);
            data.peer?.disconnect(4003, joined.refusal);
            return;
          }
          data.roomId = joined.room.id;
          data.slotId = joined.slot.id;
          data.peer?.sendReliable(encodeFrame({
            type: FrameType.Welcome,
            playerId: joined.slot.id,
            roomId: joined.room.id,
            reconnectToken: joined.token,
            maxDatagramSize: SNAPSHOT_SIZE_CEILING,
            mode: joined.room.config.mode,
            variant: joined.room.config.variant,
            ladder: joined.room.config.ladder,
            mapId: joined.room.mapId,
          }));
          data.fsm.transition("baseline-install", now);
          data.peer?.sendBaseline(joined.room.openBaseline(joined.slot.id, 0), now);
          return;
        }
        if (frame.type === FrameType.BaselineAck) {
          if (data.fsm.state !== "baseline-install" && data.fsm.state !== "resync") {
            throw new Error("unexpected baseline ack");
          }
          const room = manager.rooms.get(data.roomId);
          if (room === undefined) throw new Error("room disappeared");
          room.acknowledgeBaseline(data.slotId, frame.baselineEpoch, frame.snapshotTick);
          data.fsm.transition("active", now);
          return;
        }
        if (frame.type === FrameType.Cmd) {
          if (
            data.fsm.state !== "active" &&
            data.fsm.state !== "resync" &&
            data.fsm.state !== "baseline-install"
          ) {
            throw new Error("unexpected cmd");
          }
          manager.rooms.get(data.roomId)?.acceptCmd(data.slotId, frame, now);
          return;
        }
        if (frame.type === FrameType.Ping) {
          data.peer?.sendReliable(encodeFrame({
            type: FrameType.Pong,
            nonce: frame.nonce,
            clientTime: frame.clientTime,
            serverTick: 0,
          }));
          return;
        }
        throw new Error("unexpected client frame");
      } catch (error) {
        closeProtocol(
          data,
          RefusalCode.ProtocolError,
          error instanceof Error ? error.message : "malformed frame",
          now,
          log,
        );
      }
    },
    drain: (ws) => {
      ws.getUserData().peer?.drain();
    },
    close: (ws) => {
      const data = ws.getUserData();
      connections.delete(data);
      const now = clock();
      manager.rooms.get(data.roomId)?.disconnect(data.slotId, now, data.peer);
    },
  });

  return {
    app,
    connections,
    sweepTimeouts: (nowMs) => sweepConnectionTimeouts(connections, nowMs, log),
    drainForRestart: () => {
      for (const data of connections) {
        data.peer?.sendReliable(refusal(RefusalCode.ServerRestarting));
        data.peer?.disconnect(1012, "server restarting");
      }
    },
  };
}
