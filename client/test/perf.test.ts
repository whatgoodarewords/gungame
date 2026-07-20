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

  it("surfaces frame-time percentiles and p99 catches jitter", () => {
    const meter = new FrameBudgetMeter();
    // ~10% fat frames over a full 512-window so nearest-rank p99 lands on the
    // outlier (round(0.99*511)=506, and the top ~5 are fat): median stays at 8,
    // p99 must separate to 40 — a vacuous p99==median would fail this.
    for (let i = 0; i < 512; i += 1) {
      meter.beginFrame(0);
      meter.endFrame(i % 10 === 0 ? 40 : 8);
    }
    const snap = meter.snapshot;
    expect(snap.frameMedian).toBeCloseTo(8, 5);
    expect(snap.frameP99).toBeCloseTo(40, 5);
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

    // Latest input wins: a click that never produced a photon is overwritten by
    // the next real click rather than lingering (the 200 is discarded).
    est.markInput(200);
    est.markInput(205);
    est.sampleAtPresent(230); // 25 ms from the latest
    expect(est.sampleCount).toBe(2);

    // Negative / absurd deltas are rejected (tab restore, clock skew).
    est.markInput(1000);
    est.sampleAtPresent(500);
    est.markInput(0);
    est.sampleAtPresent(5000);
    expect(est.sampleCount).toBe(2);
    // Nearest-rank over [20, 25]: p50 and p95 both land on the upper sample.
    expect(est.medianMs).toBeCloseTo(25, 5);
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
