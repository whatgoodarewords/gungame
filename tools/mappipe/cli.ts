#!/usr/bin/env node
import { basename, dirname, extname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildMap, validatePath } from "./pipeline.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function summary(path: string, map: Awaited<ReturnType<typeof validatePath>>): string {
  const modes = [...new Set(map.spawns.map((spawn) => spawn.mode))].sort((a, b) => a - b);
  return `${path}: ${map.collision.indices.length / 3} triangles, ${map.spawns.length} spawns, modes ${modes.join(",")}, ${map.killVolumes.length} kill volumes`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "validate") {
    const source = args[1];
    if (source === undefined) throw new Error("usage: mappipe validate <map.gltf|map.blob>");
    const path = resolve(PROJECT_ROOT, source);
    console.log(`valid ${summary(source, await validatePath(path))}`);
    return;
  }
  const source = args[0];
  if (source === undefined) throw new Error("usage: mappipe <map.gltf> [--out output.blob]");
  const outIndex = args.indexOf("--out");
  const sourcePath = resolve(PROJECT_ROOT, source);
  const stem = basename(source, extname(source));
  const outputArgument = outIndex >= 0 ? args[outIndex + 1] : join("maps", `${stem}.blob`);
  if (outputArgument === undefined || outputArgument === "") throw new Error("--out requires a path");
  const output = resolve(PROJECT_ROOT, outputArgument);
  await mkdir(dirname(output), { recursive: true });
  const map = await buildMap(sourcePath, output);
  console.log(`emitted ${summary(output, map)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
