// Degenerate-triangle audit: do the maps contain zero-area faces whose
// computeVertexNormals output would NaN-poison lighting (black faces)?
import { readFileSync } from "node:fs";
import { loadGameplayMap } from "../../packages/shared/src/map.js";

for (const name of ["foundry", "spire"]) {
  const map = loadGameplayMap(readFileSync(`${import.meta.dirname}/../../maps/${name}.blob`));
  const pos = map.collision.positions;
  const idx = map.collision.indices;
  let degenerate = 0;
  let downFacing = 0;
  const bad: string[] = [];
  for (let tri = 0; tri < idx.length / 3; tri += 1) {
    const a = idx[tri * 3]! * 3, b = idx[tri * 3 + 1]! * 3, c = idx[tri * 3 + 2]! * 3;
    const abx = pos[b]! - pos[a]!, aby = pos[b + 1]! - pos[a + 1]!, abz = pos[b + 2]! - pos[a + 2]!;
    const acx = pos[c]! - pos[a]!, acy = pos[c + 1]! - pos[a + 1]!, acz = pos[c + 2]! - pos[a + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-10) {
      degenerate += 1;
      if (bad.length < 12) {
        const cx = (pos[a]! + pos[b]! + pos[c]!) / 3;
        const cy = (pos[a + 1]! + pos[b + 1]! + pos[c + 1]!) / 3;
        const cz = (pos[a + 2]! + pos[b + 2]! + pos[c + 2]!) / 3;
        bad.push(`(${cx.toFixed(1)},${cy.toFixed(1)},${cz.toFixed(1)})`);
      }
    } else if (ny / len < -0.9) {
      downFacing += 1;
    }
  }
  console.log(`${name}: tris=${idx.length / 3} degenerate=${degenerate} downFacing=${downFacing}`);
  if (bad.length > 0) console.log("  degenerate at:", bad.join(" "));
}
