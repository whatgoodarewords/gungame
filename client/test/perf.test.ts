import { describe, expect, it } from "vitest";

import { FrameBudgetMeter, PERF_BUDGETS } from "../src/perf.js";

describe("frame budget meter", () => {
  it("publishes the normative feature acceptance ceilings", () => {
    expect(PERF_BUDGETS).toEqual({
      lightingMs: 2,
      postMs: 1,
      particlesMs: 0.5,
      charactersMs: 1,
      drawCalls: 150,
      heapDeltaBytes: 5 * 1024 * 1024,
      coldLoadMs: 5_000,
    });
  });

  it("reports a stable reusable per-feature frame breakdown", () => {
    const meter = new FrameBudgetMeter();
    meter.beginFrame(10);
    meter.mark("particles", 0.25);
    meter.mark("characters", 0.5);
    meter.mark("render", 1.5);
    meter.setGpuFeatureSample("lighting", 1.25);
    meter.setGpuFeatureSample("post", 0.75);
    meter.endFrame(14);
    const first = meter.snapshot;
    expect(first).toEqual({
      frame: 4,
      render: 1.5,
      lighting: 1.25,
      post: 0.75,
      particles: 0.25,
      characters: 0.5,
    });
    expect(meter.snapshot).toBe(first);
  });

  it("clamps invalid negative durations and smooths subsequent samples", () => {
    const meter = new FrameBudgetMeter();
    meter.beginFrame(5);
    meter.mark("particles", -1);
    meter.endFrame(4);
    expect(meter.snapshot.particles).toBe(0);
    expect(meter.snapshot.frame).toBe(0);
    meter.beginFrame(10);
    meter.mark("particles", 1);
    meter.endFrame(12);
    expect(meter.snapshot.particles).toBe(1);
    expect(meter.snapshot.frame).toBe(2);
  });
});
