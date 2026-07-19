import { describe, expect, it } from "vitest";

import {
  FrameType,
  GameMode,
  GravityVariant,
  JoinKind,
  Ladder,
  PROTOCOL_VERSION,
  ProtocolError,
  decodeFrame,
  encodeFrame,
  type CmdFrame,
  type ProtocolFrame,
} from "../src/index.js";

function cmd(overrides: Partial<CmdFrame> = {}): CmdFrame {
  return {
    type: FrameType.Cmd,
    seq: 42,
    tick: 900,
    buttons: 0x55,
    viewYaw: 123.25,
    viewPitch: 120,
    fireFraction: 77,
    lastSnapshotTick: 880,
    interpTargetTick: 875,
    interpTargetFraction: 201,
    baselineEpoch: 9,
    ...overrides,
  };
}

describe("binary codec", () => {
  it("round-trips every frame family and clamps pitch", () => {
    const frames: readonly ProtocolFrame[] = [
      {
        type: FrameType.Hello,
        protocolVersion: PROTOCOL_VERSION,
        buildHash: "deadbeef",
        joinKind: JoinKind.Create,
        mode: GameMode.Scoutzknivez,
        variant: GravityVariant.Scoutz,
        ladder: Ladder.Arsenal,
        name: "Codec Bot",
        roomId: "",
        reconnectToken: new Uint8Array(),
      },
      {
        type: FrameType.Welcome,
        playerId: 12,
        roomId: "abcd1234",
        reconnectToken: new Uint8Array(16).fill(7),
        maxDatagramSize: 1_100,
        mode: GameMode.GunGame,
        variant: GravityVariant.Standard,
        ladder: Ladder.Classic,
      },
      cmd(),
      {
        type: FrameType.BaselineAck,
        baselineEpoch: 8,
        snapshotTick: 912,
      },
      { type: FrameType.Ping, nonce: 3, clientTime: 1_234.5 },
      { type: FrameType.Pong, nonce: 3, clientTime: 1_234.5, serverTick: 99 },
    ];

    for (const frame of frames) {
      const decoded = decodeFrame(encodeFrame(frame));
      expect(decoded.type).toBe(frame.type);
    }
    const decodedCmd = decodeFrame(encodeFrame(cmd()));
    expect(decodedCmd.type).toBe(FrameType.Cmd);
    if (decodedCmd.type !== FrameType.Cmd) throw new Error("wrong frame");
    expect(decodedCmd.viewPitch).toBeCloseTo(89, 4);
    expect(decodedCmd.viewYaw).toBeCloseTo(123.25, 2);
  });

  it("rejects forged, oversized, truncated, trailing, and non-finite frames", () => {
    expect(() => decodeFrame(new Uint8Array())).toThrow(ProtocolError);
    expect(() => decodeFrame(new Uint8Array(2_049))).toThrow("hard limit");
    expect(() => decodeFrame(encodeFrame(cmd()).slice(0, -1))).toThrow("invalid length");
    const trailing = new Uint8Array([...encodeFrame(cmd()), 0]);
    expect(() => decodeFrame(trailing)).toThrow("invalid length");
    expect(() => decodeFrame(Uint8Array.of(255))).toThrow("unknown frame type");

    const nanPing = encodeFrame({ type: FrameType.Ping, nonce: 1, clientTime: 1 });
    new DataView(nanPing.buffer).setUint32(5, 0x7fc0_0000, true);
    expect(() => decodeFrame(nanPing)).toThrow("finite");

    const forgedHello = encodeFrame({
      type: FrameType.Hello,
      protocolVersion: PROTOCOL_VERSION,
      buildHash: "hash",
      joinKind: JoinKind.Quickplay,
      mode: GameMode.GunGame,
      variant: GravityVariant.Standard,
      ladder: Ladder.Classic,
      name: "Fuzz_Bot",
      roomId: "",
      reconnectToken: new Uint8Array(),
    });
    forgedHello[3] = 200;
    expect(() => decodeFrame(forgedHello)).toThrow();
    expect(() => encodeFrame(cmd({ fireFraction: -1 }))).toThrow("uint8");
    expect(() => encodeFrame(cmd({ fireFraction: 256 }))).toThrow("uint8");
    expect(() => encodeFrame(cmd({ interpTargetFraction: 256 }))).toThrow("uint8");
  });

  it("survives deterministic protocol round-trip fuzz", () => {
    let state = 0x6d2b_79f5;
    const next = (): number => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return (state ^ (state >>> 14)) >>> 0;
    };
    for (let index = 0; index < 2_000; index += 1) {
      const original = cmd({
        seq: next(),
        tick: next(),
        buttons: next() & 0xffff,
        viewYaw: (next() / 0xffff_ffff) * 1_440 - 720,
        viewPitch: (next() / 0xffff_ffff) * 400 - 200,
        fireFraction: next() & 0xff,
        lastSnapshotTick: next(),
        interpTargetTick: next(),
        interpTargetFraction: next() & 0xff,
        baselineEpoch: next() & 0xffff,
      });
      const decoded = decodeFrame(encodeFrame(original));
      expect(decoded.type).toBe(FrameType.Cmd);
      if (decoded.type !== FrameType.Cmd) throw new Error("wrong frame");
      expect(decoded.seq).toBe(original.seq);
      expect(decoded.viewPitch).toBeGreaterThanOrEqual(-89);
      expect(decoded.viewPitch).toBeLessThanOrEqual(89);
      expect(Number.isFinite(decoded.viewYaw)).toBe(true);
    }
  });
});
