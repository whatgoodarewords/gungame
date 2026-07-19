import { describe, expect, it } from "vitest";

import {
  FIRE_RECIPES,
  GUNSHOT_LAYERS,
  IMPACT_RECIPES,
  MASTER_COMPRESSOR_DIALS,
  renderRecipe,
  validateRecipe,
} from "../src/audio.js";

describe("procedural audio recipes", () => {
  it("covers every weapon fire and impact identity with finite safe params", () => {
    expect(Object.keys(FIRE_RECIPES)).toHaveLength(13);
    expect(Object.keys(IMPACT_RECIPES)).toHaveLength(13);
    for (const value of [...Object.values(FIRE_RECIPES), ...Object.values(IMPACT_RECIPES)]) {
      expect(validateRecipe(value)).toBe(true);
    }
  });

  it("renders deterministic finite PCM without clipping", () => {
    for (const value of Object.values(FIRE_RECIPES)) {
      const first = renderRecipe(value, 8_000, 42);
      const second = renderRecipe(value, 8_000, 42);
      expect(second).toEqual(first);
      let peak = 0;
      for (const sample of first) {
        expect(Number.isFinite(sample)).toBe(true);
        peak = Math.max(peak, Math.abs(sample));
      }
      expect(peak).toBeLessThanOrEqual(1);
    }
  });

  it("defines the three tactile shot layers and gentle master compression", () => {
    expect(GUNSHOT_LAYERS).toEqual(["mechanical", "body", "tail"]);
    expect(MASTER_COMPRESSOR_DIALS.ratio).toBeLessThanOrEqual(3);
    expect(MASTER_COMPRESSOR_DIALS.thresholdDb).toBeLessThan(0);
    expect(MASTER_COMPRESSOR_DIALS.attackSeconds).toBeGreaterThan(0);
  });
});
