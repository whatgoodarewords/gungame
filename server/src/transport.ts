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

interface ConnectionData {
  readonly fsm: ConnectionFsm;
  readonly limiter: ConnectionRateLimit;
  peer: WsPeer | undefined;
  roomId: string;
  slotId: number;
}

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
  }
}

export class WsPeer implements PlayerPeer {
  private pendingSnapshot: Uint8Array | undefined;
  private aboveHigh = false;
  private ended = false;
  private readonly ws: WebSocket<ConnectionData>;

  constructor(ws: WebSocket<ConnectionData>) {
    this.ws = ws;
  }

  sendReliable(bytes: Uint8Array): void {
    if (this.ended) return;
    if (this.ws.getBufferedAmount() >= BACKPRESSURE_HARD) {
      this.closeForBackpressure();
      return;
    }
    this.ws.send(bytes, true, false);
  }

  sendBaseline(bytes: Uint8Array): void {
    const data = this.ws.getUserData();
    if (data.fsm.state === "active") data.fsm.transition("resync", performance.now());
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

function closeProtocol(data: ConnectionData, code: RefusalFrame["code"], reason: string): void {
  const now = performance.now();
  data.fsm.malformed(now);
  data.peer?.sendReliable(refusal(code));
  data.peer?.disconnect(4002, reason);
}

export interface TransportServer {
  readonly app: uWS.TemplatedApp;
  readonly connections: ReadonlySet<ConnectionData>;
  sweepTimeouts(nowMs: number): void;
}

export function createTransport(manager: RoomManager): TransportServer {
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
      const now = performance.now();
      response.upgrade<ConnectionData>(
        {
          fsm: new ConnectionFsm(now),
          limiter: new ConnectionRateLimit(now),
          peer: undefined,
          roomId: "",
          slotId: 0,
        },
        request.getHeader("sec-websocket-key"),
        request.getHeader("sec-websocket-protocol"),
        request.getHeader("sec-websocket-extensions"),
        context,
      );
    },
    open: (ws) => {
      const data = ws.getUserData();
      data.peer = new WsPeer(ws);
      data.fsm.transition("hello", performance.now());
      connections.add(data);
    },
    message: (ws, raw, isBinary) => {
      const data = ws.getUserData();
      const now = performance.now();
      if (!isBinary) {
        closeProtocol(data, RefusalCode.ProtocolError, "binary frames required");
        return;
      }
      if (!data.limiter.accept(raw.byteLength, now)) {
        closeProtocol(data, RefusalCode.RateLimited, "rate limit");
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
          }));
          data.fsm.transition("baseline-install", now);
          data.peer?.sendBaseline(joined.room.openBaseline(joined.slot.id, 0));
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
          manager.rooms.get(data.roomId)?.acceptCmd(data.slotId, frame);
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
        );
      }
    },
    drain: (ws) => {
      ws.getUserData().peer?.drain();
    },
    close: (ws) => {
      const data = ws.getUserData();
      connections.delete(data);
      manager.rooms.get(data.roomId)?.disconnect(data.slotId, performance.now());
    },
  });

  return {
    app,
    connections,
    sweepTimeouts: (nowMs) => {
      for (const data of connections) {
        if (data.fsm.state !== "closing" && data.fsm.timedOut(nowMs)) {
          data.fsm.transition("closing", nowMs);
          data.peer?.disconnect(4000, "state timeout");
        }
      }
    },
  };
}
