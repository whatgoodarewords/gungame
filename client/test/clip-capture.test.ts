import { describe, expect, it } from "vitest";

import { RollingWindow } from "../src/clip-capture.js";

describe("clip-that rolling window", () => {
  it("keeps exactly the newest twelve seconds in deterministic order", () => {
    const ring = new RollingWindow<string>(12_000);
    ring.push(0, "old");
    ring.push(8_000, "airshot");
    ring.push(20_000, "multikill");
    expect(ring.values(20_000)).toEqual(["airshot", "multikill"]);
    expect(ring.values(20_001)).toEqual(["multikill"]);
  });
});
