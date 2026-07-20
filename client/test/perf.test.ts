import { describe, expect, it } from "vitest";

import { FrameBudgetMeter, LatencyEstimator, PERF_BUDGETS } from "../src/perf.js";

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
      frameMedian: 0,
      frameP99: 0,
    });
    expect(meter.snapshot).toBe(first);
  });

  it("surfaces frame-time percentiles once the ring recomputes", () => {
    const meter = new FrameBudgetMeter();
    // Recompute is throttled to every 30 pushes; drive a full window plus a
    // single fat frame so p99 separates from the median.
    for (let i = 0; i < 60; i += 1) {
      meter.beginFrame(0);
      meter.endFrame(i === 30 ? 40 : 8);
    }
    const snap = meter.snapshot;
    expect(snap.frameMedian).toBeCloseTo(8, 5);
    expect(snap.frameP99).toBeGreaterThanOrEqual(snap.frameMedian);
  });
});

describe("click-to-photon estimator", () => {
  it("measures event→present latency and ignores clock skew", () => {
    const est = new LatencyEstimator();
    // Present with nothing pending is a no-op.
    est.sampleAtPresent(100);
    expect(est.sampleCount).toBe(0);

    est.markInput(100);
    est.sampleAtPresent(120); // 20 ms
    expect(est.sampleCount).toBe(1);
    expect(est.medianMs).toBeCloseTo(20, 5);

    // Only the earliest un-presented input counts toward one sample.
    est.markInput(200);
    est.markInput(205);
    est.sampleAtPresent(230); // 30 ms from the first
    expect(est.sampleCount).toBe(2);

    // Negative / absurd deltas are rejected (tab restore, clock skew).
    est.markInput(1000);
    est.sampleAtPresent(500);
    est.markInput(0);
    est.sampleAtPresent(5000);
    expect(est.sampleCount).toBe(2);
    // Nearest-rank over [20, 30]: p50 and p95 both land on the upper sample.
    expect(est.medianMs).toBeCloseTo(30, 5);
    expect(est.p95Ms).toBeGreaterThanOrEqual(est.medianMs);
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
