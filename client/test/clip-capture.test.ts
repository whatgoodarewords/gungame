import { describe, expect, it } from "vitest";

import {
  RollingWindow,
  rebaseWebmWindow,
  requestFinalRecorderData,
} from "../src/clip-capture.js";

describe("clip-that rolling window", () => {
  it("keeps exactly the newest twelve seconds in deterministic order", () => {
    const ring = new RollingWindow<string>(12_000);
    ring.push(0, "old");
    ring.push(8_000, "airshot");
    ring.push(20_000, "multikill");
    expect(ring.values(20_000)).toEqual(["airshot", "multikill"]);
    expect(ring.values(20_001)).toEqual(["multikill"]);
  });

  it("keeps only one WebM header and rebases retained cluster timestamps to zero", () => {
    const header = Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x80);
    const cluster = (timecode: number): Uint8Array => Uint8Array.of(
      0x1f, 0x43, 0xb6, 0x75,
      0x85,
      0xe7, 0x82, (timecode >>> 8) & 0xff, timecode & 0xff,
    );
    const initialization = Uint8Array.from([...header, ...cluster(0)]);
    const exported = rebaseWebmWindow(initialization, [
      cluster(60_000),
      cluster(60_500),
    ]);
    expect([...exported.subarray(0, header.length)]).toEqual([...header]);
    expect([...exported].filter((byte, index, all) =>
      byte === 0x1a && all[index + 1] === 0x45)).toHaveLength(1);
    expect([...exported.slice(header.length)]).toEqual([
      ...cluster(0),
      ...cluster(500),
    ]);
  });

  it("awaits the requestData event before final assembly can continue", async () => {
    class FakeRecorder extends EventTarget {
      readonly state = "recording" as const;
      requested = false;

      requestData(): void {
        this.requested = true;
        queueMicrotask(() => this.dispatchEvent(new Event("dataavailable")));
      }
    }
    const recorder = new FakeRecorder();
    const flushed = requestFinalRecorderData(recorder as unknown as MediaRecorder);
    expect(recorder.requested).toBe(true);
    let settled = false;
    void flushed.then(() => { settled = true; });
    expect(settled).toBe(false);
    await flushed;
    expect(settled).toBe(true);
  });

  it("does not assemble a clip when the recorder never confirms its final flush", async () => {
    class SilentRecorder extends EventTarget {
      readonly state = "recording" as const;
      requestData(): void {}
    }
    await expect(requestFinalRecorderData(
      new SilentRecorder() as unknown as MediaRecorder,
    )).rejects.toThrow("final data flush timed out");
  });
});
