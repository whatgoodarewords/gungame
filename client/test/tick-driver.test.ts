import { describe, expect, it } from "vitest";

import { OffRenderTickDriver } from "../src/tick-driver.js";

const TICK_SECONDS = 1 / 64; // 15.625 ms

describe("OffRenderTickDriver.alphaAt (F3 — render-time interpolation phase)", () => {
  function harness() {
    let clock = 1_000;
    let pending: (() => void) | null = null;
    let ticks = 0;
    const driver = new OffRenderTickDriver(
      () => { ticks += 1; },
      () => clock,
      (cb) => { pending = cb; },
      TICK_SECONDS,
    );
    return {
      driver,
      setClock: (ms: number) => { clock = ms; },
      wake: () => { pending?.(); },
      get ticks() { return ticks; },
    };
  }

  it("advances alpha with the caller's clock between driver wakes", () => {
    const h = harness();
    h.driver.start(); // previousMs = 1000, accumulator = 0
    // No wake yet: alpha must still reflect elapsed real time, not the stale 0.
    expect(h.driver.alphaAt(1_008)).toBeCloseTo(8 / (TICK_SECONDS * 1_000), 3);
    // The bare getter is now live too (reads injected now()).
    h.setClock(1_004);
    expect(h.driver.alpha).toBeCloseTo(4 / (TICK_SECONDS * 1_000), 3);
  });

  it("clamps to 1 when the render instant overruns the next tick boundary", () => {
    const h = harness();
    h.driver.start();
    // 20 ms elapsed > one 15.625 ms tick, but the loop has not consumed it yet.
    expect(h.driver.alphaAt(1_020)).toBe(1);
  });

  it("resets the sub-tick phase after the loop consumes a tick", () => {
    const h = harness();
    h.driver.start();
    h.setClock(1_020); // 20 ms => one tick + 4.375 ms remainder
    h.wake();
    expect(h.ticks).toBe(1);
    // Remainder alpha at the wake instant: 4.375 / 15.625 ≈ 0.28.
    expect(h.driver.alphaAt(1_020)).toBeCloseTo(4.375 / (TICK_SECONDS * 1_000), 2);
    // And it keeps advancing from there without another wake.
    expect(h.driver.alphaAt(1_024)).toBeCloseTo(8.375 / (TICK_SECONDS * 1_000), 2);
  });

  it("never returns a negative alpha if the clock goes backwards", () => {
    const h = harness();
    h.driver.start();
    expect(h.driver.alphaAt(990)).toBeGreaterThanOrEqual(0);
  });
});
