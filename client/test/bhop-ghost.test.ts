import { describe, expect, it } from "vitest";

import { MapId } from "@gungame/protocol";

import {
  BHOP_ROUTES,
  BHOP_TRIAL_TIMEOUT_MS,
  BhopTimeTrial,
  deserializeGhost,
  serializeGhost,
  type GhostLap,
} from "../src/bhop-ghost.js";

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

describe("bhop trial aborts", () => {
  const storage = (): Pick<Storage, "getItem" | "setItem"> => ({
    getItem: () => null,
    setItem: () => {},
  });
  const start = (trial: BhopTimeTrial): void => {
    const gate = trial.route.startGate;
    const center = {
      x: (gate.min.x + gate.max.x) / 2,
      y: (gate.min.y + gate.max.y) / 2,
      z: (gate.min.z + gate.max.z) / 2,
    };
    trial.update(center, 100);
    trial.update({ ...center, z: gate.min.z - 0.1 }, 200);
  };

  it("aborts an abandoned lap on timeout", () => {
    const trial = new BhopTimeTrial(BHOP_ROUTES[MapId.Cascade], storage());
    start(trial);
    const result = trial.update({ x: 0, y: 2, z: 0 }, 200 + BHOP_TRIAL_TIMEOUT_MS);
    expect(result).toMatchObject({ active: false, visible: false, aborted: "timeout" });
  });

  it("aborts immediately on death", () => {
    const trial = new BhopTimeTrial(BHOP_ROUTES[MapId.Foundry], storage());
    start(trial);
    expect(trial.update({ x: -10, y: 0, z: -10 }, 300, false))
      .toMatchObject({ active: false, visible: false, aborted: "death" });
  });

  it("aborts after leaving the route envelope", () => {
    const trial = new BhopTimeTrial(BHOP_ROUTES[MapId.Duna], storage());
    start(trial);
    expect(trial.update({ x: 500, y: 0, z: 500 }, 300))
      .toMatchObject({ active: false, visible: false, aborted: "leave-radius" });
  });
});
