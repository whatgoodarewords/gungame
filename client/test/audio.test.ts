import { describe, expect, it } from "vitest";

import { FIRE_RECIPES, IMPACT_RECIPES, renderRecipe, validateRecipe } from "../src/audio.js";

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
});
