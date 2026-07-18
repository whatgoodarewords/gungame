import { describe, expect, it } from "vitest";

import {
  CmdAcceptanceWindow,
  FrameType,
  ProtocolError,
  type CmdFrame,
} from "../src/index.js";

function cmd(seq: number, snapshot = seq, epoch = 1): CmdFrame {
  return {
    type: FrameType.Cmd,
    seq,
    tick: seq,
    buttons: 0,
    viewYaw: 0,
    viewPitch: 0,
    fireFraction: 0,
    lastSnapshotTick: snapshot,
    interpTargetTick: snapshot,
    interpTargetFraction: 0,
    baselineEpoch: epoch,
  };
}

describe("forward-sliding command window", () => {
  it("dedupes replay, retains newest eight, and advances ack across gaps", () => {
    const window = new CmdAcceptanceWindow();
    for (let seq = 1; seq <= 40; seq += 1) expect(window.accept(cmd(seq))).toBe(true);
    expect(window.size).toBe(8);
    expect(window.lastProcessedCmdSeq).toBe(32);
    expect(window.accept(cmd(32))).toBe(false);
    const consumed = window.consume(() => "current");
    expect(consumed?.cmd.seq).toBe(33);
    expect(window.lastProcessedCmdSeq).toBe(33);
  });

  it("validates snapshot monotonicity only during seq-ordered consumption", () => {
    const window = new CmdAcceptanceWindow();
    window.accept(cmd(2, 20));
    window.accept(cmd(1, 10));
    expect(window.consume(() => "current")?.cmd.seq).toBe(1);
    expect(window.consume(() => "current")?.cmd.seq).toBe(2);
    expect(window.accept(cmd(2, 1))).toBe(false);

    window.accept(cmd(4, 19));
    expect(() => window.consume(() => "current")).toThrow(ProtocolError);
  });

  it("consumes prior-epoch cmds as valid-stale without baselining checks", () => {
    const window = new CmdAcceptanceWindow();
    window.accept(cmd(1, 100, 1));
    window.accept(cmd(2, 1, 2));
    expect(window.consume(() => "current")?.cmd.seq).toBe(1);
    expect(window.consume(() => "valid-stale")?.cmd.seq).toBe(2);
  });

  it("recovers from a 500 ms (32 tick) outage within four ticks", () => {
    const window = new CmdAcceptanceWindow();
    window.accept(cmd(1));
    window.consume(() => "current");
    const outageTicks = 32;
    window.accept(cmd(1 + outageTicks + 1));
    let resumedAt = 0;
    for (let tick = 1; tick <= 4; tick += 1) {
      if (window.consume(() => "current") !== undefined) {
        resumedAt = tick;
        break;
      }
    }
    expect(resumedAt).toBeGreaterThan(0);
    expect(resumedAt).toBeLessThanOrEqual(4);
  });
});
