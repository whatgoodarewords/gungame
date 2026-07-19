import { describe, expect, it } from "vitest";

import {
  ClientBaselineEpochs,
  ConnectionFsm,
  ProtocolError,
  ServerBaselineEpochs,
} from "../src/index.js";

describe("connection FSM", () => {
  it("accepts the lifecycle including active/resync", () => {
    const fsm = new ConnectionFsm(0);
    fsm.transition("hello", 1);
    fsm.transition("baseline-install", 2);
    fsm.transition("active", 3);
    fsm.transition("resync", 4);
    fsm.transition("active", 5);
    fsm.transition("closing", 6);
    expect(fsm.state).toBe("closing");
  });

  it("rejects every illegal shortcut and closes on malformed input", () => {
    const illegal: readonly [Parameters<ConnectionFsm["transition"]>[0], number][] = [
      ["active", 1],
      ["resync", 2],
      ["baseline-install", 3],
    ];
    for (const [state, now] of illegal) {
      const fsm = new ConnectionFsm(0);
      expect(() => fsm.transition(state, now)).toThrow(ProtocolError);
    }
    const malformed = new ConnectionFsm(0);
    malformed.transition("hello", 1);
    malformed.malformed(2);
    expect(malformed.state).toBe("closing");
    expect(() => malformed.transition("active", 3)).toThrow(ProtocolError);
  });

  it("applies per-state monotonic timeouts", () => {
    const fsm = new ConnectionFsm(10);
    expect(fsm.timedOut(5_010)).toBe(false);
    fsm.touch(100);
    expect(fsm.timedOut(5_100)).toBe(false);
    expect(fsm.timedOut(5_101)).toBe(true);
    expect(() => fsm.timedOut(9)).toThrow("monotonic");
  });
});

describe("baseline epochs", () => {
  it("suspends deltas until ack and admits only immediately-prior stale traffic", () => {
    const server = new ServerBaselineEpochs();
    const first = server.openFull(10);
    expect(first).toBe(1);
    expect(server.deltasSuspended).toBe(true);
    expect(server.classifyReference(first)).toBe("current");
    server.acknowledge(first, 10);
    expect(server.deltasSuspended).toBe(false);

    const second = server.openFull(20);
    expect(server.classifyReference(second)).toBe("current");
    expect(server.classifyReference(first)).toBe("valid-stale");
    expect(() => server.classifyReference(77)).toThrow("cross-epoch");
    expect(() => server.acknowledge(second, 19)).toThrow("never sent");
    server.acknowledge(second, 20);
    expect(() => server.classifyReference(first)).toThrow("cross-epoch");
  });

  it("keeps the installed plus pending chain valid across a refocus race", () => {
    const server = new ServerBaselineEpochs();
    const installed = server.openFull(10);
    server.acknowledge(installed, 10);
    const pending = server.openFull(20);
    const refocus = server.openFull(21);
    expect(server.classifyReference(installed)).toBe("valid-stale");
    expect(server.classifyReference(pending)).toBe("valid-stale");
    expect(server.classifyReference(refocus)).toBe("current");
    server.acknowledge(refocus, 21);
    expect(server.classifyReference(refocus)).toBe("current");
  });

  it("treats duplicate and superseded acknowledgements as idempotent", () => {
    const server = new ServerBaselineEpochs();
    const first = server.openFull(10);
    const second = server.openFull(11);
    server.acknowledge(second, 11);
    expect(() => server.acknowledge(second, 11)).not.toThrow();
    expect(() => server.acknowledge(first, 10)).not.toThrow();
    expect(() => server.acknowledge(77, 10)).toThrow("never sent");
  });

  it("generation-fences client epoch traffic", () => {
    const client = new ClientBaselineEpochs();
    client.installFull(1);
    client.installFull(2);
    expect(client.classifyTraffic(2)).toBe("current");
    expect(client.classifyTraffic(1)).toBe("valid-stale");
    client.finishResync();
    expect(() => client.classifyTraffic(1)).toThrow("cross-epoch");
  });
});
