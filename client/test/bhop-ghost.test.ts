import { describe, expect, it } from "vitest";

import { MapId } from "@gungame/protocol";

import { deserializeGhost, serializeGhost, type GhostLap } from "../src/bhop-ghost.js";

describe("bhop ghost serialization", () => {
  it("round-trips a per-map best lap and rejects foreign or malformed data", () => {
    const lap: GhostLap = {
      version: 1,
      mapId: MapId.Cascade,
      durationMs: 8_421,
      samples: [
        { timeMs: 0, x: 0, y: 2, z: 20 },
        { timeMs: 8_421, x: 0, y: 2, z: 20 },
      ],
    };
    expect(deserializeGhost(serializeGhost(lap), MapId.Cascade)).toEqual(lap);
    expect(deserializeGhost(serializeGhost(lap), MapId.Foundry)).toBeUndefined();
    expect(deserializeGhost('{"version":1}', MapId.Cascade)).toBeUndefined();
  });
});
