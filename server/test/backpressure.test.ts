import { describe, expect, it } from "vitest";

import {
  ConnectionFsm,
  FrameType,
  RefusalCode,
  decodeFrame,
} from "@gungame/protocol";

import { AuthoritativeLoop } from "../src/loop.js";
import { ConnectionRateLimit } from "../src/rate-limit.js";
import {
  WsPeer,
  sweepConnectionTimeouts,
  type ConnectionData,
} from "../src/transport.js";

class FakeSocket {
  buffered = 0;
  readonly sent: Uint8Array[] = [];
  readonly ended: Array<readonly [number | undefined, string]> = [];
  userData: unknown;

  getBufferedAmount(): number {
    return this.buffered;
  }

  send(bytes: Uint8Array): number {
    this.sent.push(bytes.slice());
    return 1;
  }

  end(code?: number, reason = ""): void {
    this.ended.push([code, reason]);
  }

  getUserData(): unknown {
    return this.userData;
  }
}

function managedConnection(fsm: ConnectionFsm): {
  readonly data: ConnectionData;
  readonly socket: FakeSocket;
} {
  const socket = new FakeSocket();
  const data: ConnectionData = {
    fsm,
    limiter: new ConnectionRateLimit(0),
    peer: undefined,
    roomId: "regression-room",
    slotId: 7,
    quarantined: false,
  };
  socket.userData = data;
  data.peer = new WsPeer(socket as never);
  return { data, socket };
}

describe("one-slot WS backpressure", () => {
  it("replaces an unsent snapshot with the newest and drains below hysteresis", () => {
    const socket = new FakeSocket();
    const peer = new WsPeer(socket as never);
    socket.buffered = 40 * 1_024;
    peer.sendSnapshot(Uint8Array.of(1));
    peer.sendSnapshot(Uint8Array.of(2));
    expect(socket.sent).toEqual([]);
    socket.buffered = 0;
    peer.drain();
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).toEqual(Uint8Array.of(2));
  });

  it("sends a typed refusal and closes at the hard threshold", () => {
    const socket = new FakeSocket();
    const peer = new WsPeer(socket as never);
    socket.buffered = 256 * 1_024;
    peer.sendSnapshot(Uint8Array.of(1));
    expect(socket.sent).toHaveLength(1);
    expect(socket.ended[0]?.[1]).toBe("backpressure");
  });

  it("moves an active connection into resync before sending a full baseline", () => {
    const fsm = new ConnectionFsm(0);
    fsm.transition("hello", 1);
    fsm.transition("baseline-install", 2);
    fsm.transition("active", 3);
    const socket = new FakeSocket();
    socket.userData = { fsm };
    const peer = new WsPeer(socket as never);
    peer.sendBaseline(Uint8Array.of(5), 4);
    expect(fsm.state).toBe("resync");
    expect(socket.sent[0]).toEqual(Uint8Array.of(5));
  });
});

describe("connection-scoped FSM containment", () => {
  it("does not throw when an uncleanly dropped connection is swept behind its FSM time", () => {
    const dropped = managedConnection(new ConnectionFsm(100));
    const logs: string[] = [];

    expect(() => sweepConnectionTimeouts(
      [dropped.data],
      50,
      (message) => logs.push(message),
    )).not.toThrow();
    expect(() => sweepConnectionTimeouts([dropped.data], 51)).not.toThrow();

    expect(dropped.data.quarantined).toBe(true);
    expect(dropped.socket.ended[0]?.[0]).toBe(4002);
    expect(dropped.socket.ended[0]?.[1]).toContain("protocol state error");
    expect(logs[0]).toContain("timeout sweep");
    expect(decodeFrame(dropped.socket.sent[0] ?? new Uint8Array())).toEqual({
      type: FrameType.Refusal,
      code: RefusalCode.ProtocolError,
    });
  });

  it("quarantines one non-monotonic FSM while the loop and other connections tick on", () => {
    const badFsm = new ConnectionFsm(0);
    badFsm.transition("hello", 1);
    badFsm.transition("baseline-install", 2);
    badFsm.transition("active", 20);
    const bad = managedConnection(badFsm);

    const healthyFsm = new ConnectionFsm(0);
    healthyFsm.transition("hello", 1);
    healthyFsm.transition("baseline-install", 2);
    healthyFsm.transition("active", 3);
    const healthy = managedConnection(healthyFsm);
    const connections = [bad.data, healthy.data];
    const logs: string[] = [];
    let nowMs = 16;
    let healthyTicks = 0;
    const loop = new AuthoritativeLoop(
      () => {
        if (!healthy.data.quarantined) healthyTicks += 1;
      },
      () => nowMs,
      (message) => logs.push(message),
      (now) => sweepConnectionTimeouts(
        connections,
        now,
        (message) => logs.push(message),
      ),
    );

    expect(loop.wake(nowMs)).toBe(1);
    expect(bad.data.quarantined).toBe(true);
    expect(bad.socket.ended[0]?.[0]).toBe(4002);
    expect(healthy.data.quarantined).toBe(false);
    nowMs = 32;
    expect(loop.wake(nowMs)).toBe(1);
    expect(healthyTicks).toBe(2);
    expect(logs.filter((message) => message.includes("connection quarantined"))).toHaveLength(1);
  });
});
