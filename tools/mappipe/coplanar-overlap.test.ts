import { strict as assert } from "node:assert";

import { validateNoParallelCoplanarOverlap } from "./pipeline.js";

const collision = (
  positions: readonly number[],
  indices: readonly number[],
): { positions: Float32Array; indices: Uint32Array } => ({
  positions: Float32Array.from(positions),
  indices: Uint32Array.from(indices),
});

assert.throws(
  () => validateNoParallelCoplanarOverlap(collision([
    0, 0, 0, 2, 0, 0, 0, 0, 2,
    0.25, 0.0005, 0.25, 1.5, 0.0005, 0.25, 0.25, 0.0005, 1.5,
  ], [0, 1, 2, 3, 4, 5])),
  /parallel-coplanar overlap within 0.001 m/,
);

assert.doesNotThrow(
  () => validateNoParallelCoplanarOverlap(collision([
    0, 0, 0, 1, 0, 0, 0, 0, 1,
    1, 0, 0, 2, 0, 0, 1, 0, 1,
    0.25, 0.0011, 0.25, 0.75, 0.0011, 0.25, 0.25, 0.0011, 0.75,
  ], [0, 1, 2, 3, 4, 5, 6, 7, 8])),
);

console.log("coplanar-overlap validator: rejects <1 mm overlap; permits edge contact and >1 mm separation");
