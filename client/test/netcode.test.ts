import { describe, expect, it } from "vitest";

import {
  EntityKind,
  JoinKind,
  Ladder,
  type EntityState,
} from "@gungame/protocol";
import { TICK_DT, WeaponId } from "@gungame/shared";
import { Buttons, createInitialState, CollisionWorld, type Cmd } from "@gungame/sim";

import { ClockSync } from "../src/net/clock.js";
import { createJoinHello } from "../src/net/session.js";
import { RemoteInterpolation } from "../src/net/interpolation.js";
import { PredictionReconciler } from "../src/net/prediction.js";
import { quickplayUrl } from "../src/room-url.js";
import { OffRenderTickDriver } from "../src/tick-driver.js";

function boxWorld(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): CollisionWorld {
  const [minX, minY, minZ] = min;
  const [maxX, maxY, maxZ] = max;
  const positions = Float32Array.from([
    minX, minY, minZ, maxX, minY, minZ, maxX, maxY, minZ, minX, maxY, minZ,
    minX, minY, maxZ, maxX, minY, maxZ, maxX, maxY, maxZ, minX, maxY, maxZ,
  ]);
  const indices = Uint32Array.from([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
    0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ]);
  return new CollisionWorld({ positions, indices });
}

function entity(generation: number, x: number): EntityState {
  return {
    id: 2,
    generation,
    position: { x, y: 0, z: 0 },
    velocity: { x: 1, y: 0, z: 0 },
    viewYaw: 0,
    viewPitch: 0,
    grounded: true,
    alive: true,
    kind: EntityKind.Player,
    health: 100,
    weaponTier: 1,
    ammo: 0,
    ownerId: 0,
    fireCmdSeq: 0,
    weaponId: 0,
  };
}

describe("hello routing", () => {
  it("keeps explicit legacy invites fresh when a copied tab inherited the owner's token", () => {
    const hello = createJoinHello({
      pathname: "/gg/",
      search: "?room=r000042&name=Guest",
      buildHash: "test",
      storedReconnectToken: "00112233445566778899aabbccddeeff",
    });

    expect(hello.joinKind).toBe(JoinKind.Invite);
    expect(hello.roomId).toBe("r000042");
    expect(hello.reconnectToken).toHaveLength(0);
  });

  it("builds quickplay and ARSENAL-create hellos without residual room state", () => {
    const quickplay = createJoinHello({
      pathname: "/gg/",
      search: "?name=First",
      buildHash: "test",
      storedReconnectToken: null,
    });
    const arsenal = createJoinHello({
      pathname: "/gg/",
      search: "?name=Owner&create=1&mode=gungame&ladder=arsenal",
      buildHash: "test",
      storedReconnectToken: null,
    });

    expect(quickplay.joinKind).toBe(JoinKind.Quickplay);
    expect(quickplay.roomId).toBe("");
    expect(arsenal.joinKind).toBe(JoinKind.Create);
    expect(arsenal.ladder).toBe(Ladder.Arsenal);
  });

  it("turns a room-scoped page back into a fresh quickplay hello", () => {
    const url = new URL(quickplayUrl(
      "https://dev.sml.world/gg/r/r000042?name=Second&room=stale&create=1&ladder=arsenal",
    ));
    const hello = createJoinHello({
      pathname: url.pathname,
      search: url.search,
      buildHash: "test",
      storedReconnectToken: "00112233445566778899aabbccddeeff",
    });

    expect(url.pathname).toBe("/gg/");
    expect(url.searchParams.get("name")).toBe("Second");
    expect(hello.joinKind).toBe(JoinKind.Quickplay);
    expect(hello.roomId).toBe("");
    expect(hello.reconnectToken).toHaveLength(0);
  });
});

describe("clock sync and pacing", () => {
  it("uses RTT/2, step-resyncs above 250 ms, and slews cmd bias at <=1 tick/s", () => {
    const clock = new ClockSync();
    clock.observePong(0, 100);
    expect(clock.roundTripMs).toBe(100);
    clock.observeServerTick(100, 1_000);
    expect(clock.consumeStepResync()).toBe(true);
    clock.commandTick(0, 2, 1_000);
    const before = clock.commandBiasTicks;
    clock.commandTick(0, 9, 1_500);
    expect(before - clock.commandBiasTicks).toBeLessThanOrEqual(0.5);
  });

  it("keeps the connection active and sends cmds through 3 s with no render frames", () => {
    let clockMs = 0;
    let commands = 0;
    const connection = { active: true };
    const queue: Array<{ due: number; callback: () => void }> = [];
    const driver = new OffRenderTickDriver(
      () => {
        if (connection.active) commands += 1;
      },
      () => clockMs,
      (callback, delayMs) => queue.push({ due: clockMs + delayMs, callback }),
    );
    driver.start();
    while (queue.length > 0) {
      queue.sort((left, right) => left.due - right.due);
      const next = queue.shift()!;
      if (next.due > 3_000) break;
      clockMs = next.due;
      next.callback();
    }
    driver.stop();
    expect(connection.active).toBe(true);
    expect(commands).toBeGreaterThanOrEqual(190);
    expect(commands).toBeLessThanOrEqual(192);
  });
});

describe("prediction reconciliation", () => {
  it("never leaves the render capsule in geometry after a wall-side correction", () => {
    const world = boxWorld([0.5, -2, -2], [0.7, 3, 2]);
    const invalidPredicted = createInitialState();
    const reconciler = new PredictionReconciler({
      ...invalidPredicted,
      player: {
        ...invalidPredicted.player,
        position: { x: 0.3, y: 0, z: 0 },
      },
    }, world);
    const authoritative = {
      ...invalidPredicted,
      player: {
        ...invalidPredicted.player,
        position: { x: -0.1, y: 0, z: 0 },
      },
    };
    reconciler.reconcile(authoritative, 0);
    const renderPosition = reconciler.renderPosition(0);
    expect(world.capsuleFits(renderPosition)).toBe(true);
    expect(renderPosition).toEqual(authoritative.player.position);
  });

  it("replays own projectile world detonation and self-impulse during reconciliation", () => {
    const world = boxWorld([-2, 0, -0.75], [2, 3, -0.6]);
    const authoritative = createInitialState("rocket-jumper");
    const reconciler = new PredictionReconciler(authoritative, world);
    reconciler.configureCombat(1, 1, WeaponId.Peacemaker);
    const cmd = (seq: number, buttons: number): Cmd => ({
      seq,
      tick: seq,
      buttons,
      viewYaw: 0,
      viewPitch: 0,
      fireFraction: 128,
      lastSnapshotTick: 0,
      interpTargetTick: 0,
      interpTargetFraction: 0,
    });
    reconciler.predict(cmd(1, Buttons.Fire));
    const predicted = reconciler.predict(cmd(2, 0));
    expect(predicted.player.velocity.z).toBeGreaterThan(0);
    const rebuilt = reconciler.reconcile(authoritative, 0);
    expect(rebuilt.player.velocity).toEqual(predicted.player.velocity);
    expect(rebuilt.tick).toBe(2);
    expect(TICK_DT).toBe(1 / 64);
  });
});

describe("remote interpolation", () => {
  it("uses pinned delays, adapts only to seven, and never crosses a generation", () => {
    const ws = new RemoteInterpolation("ws");
    const datagram = new RemoteInterpolation("datagram");
    expect(ws.delayTicks).toBe(5);
    expect(datagram.delayTicks).toBe(3);
    for (let index = 0; index < 10; index += 1) ws.noteStall(true);
    expect(ws.delayTicks).toBe(7);

    ws.push(10, [entity(1, 0)], 1);
    ws.push(11, [entity(2, 10)], 1);
    const sampled = ws.sample(10, 128);
    expect(sampled[0]?.generation).toBe(2);
    expect(sampled[0]?.position.x).toBe(10);
  });

  it("dead-reckons by velocity when starved instead of freezing (F1)", () => {
    const ws = new RemoteInterpolation("ws");
    // Single buffered snapshot at tick 10, moving +1 unit/s along x.
    ws.push(10, [entity(2, 0)], 1);
    // Target one tick past the newest buffered state → starved.
    const oneAhead = ws.sample(11, 0);
    expect(ws.lastSampleStalled).toBe(true);
    // Extrapolated forward, not frozen at x=0.
    expect(oneAhead[0]!.position.x).toBeCloseTo((1 / 64) * 1, 6);

    // Extrapolation is bounded to 2 ticks even far past the buffer.
    const farAhead = ws.sample(100, 0);
    expect(farAhead[0]!.position.x).toBeCloseTo((2 / 64) * 1, 6);
    expect(ws.lastSampleStalled).toBe(true);
  });

  it("reports no stall and decays the adaptive delay when snapshots flow (F1)", () => {
    const ws = new RemoteInterpolation("ws");
    for (let i = 0; i < 10; i += 1) ws.noteStall(true);
    expect(ws.delayTicks).toBe(7);

    ws.push(10, [entity(1, 0)], 1);
    ws.push(12, [entity(1, 20)], 1);
    // Target sits inside the buffered span → healthy, not starved.
    ws.sample(11, 0);
    expect(ws.lastSampleStalled).toBe(false);

    // Enough clean frames decay the widened delay back to the base floor of 5.
    for (let i = 0; i < 60; i += 1) ws.noteStall(false);
    expect(ws.delayTicks).toBe(5);
  });
});
