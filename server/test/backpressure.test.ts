import { describe, expect, it } from "vitest";

import { ConnectionFsm } from "@gungame/protocol";

import { WsPeer } from "../src/transport.js";

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
    peer.sendBaseline(Uint8Array.of(5));
    expect(fsm.state).toBe("resync");
    expect(socket.sent[0]).toEqual(Uint8Array.of(5));
  });
});
