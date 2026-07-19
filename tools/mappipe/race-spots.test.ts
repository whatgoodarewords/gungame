import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";

import { MapSecretKind } from "@gungame/shared";

import { validatePath } from "./pipeline.js";

for (const name of ["spire", "foundry", "duna", "cascade"] as const) {
  const map = await validatePath(fileURLToPath(new URL(`../../maps/${name}.blob`, import.meta.url)));
  const count = map.secrets.filter((secret) => secret.kind === MapSecretKind.RaceSpot).length;
  assert.ok(count >= 1 && count <= 2, `${name} race-spot count ${count}`);
}

console.log("race-spot validator: 4 maps · 1-2 spots each");
