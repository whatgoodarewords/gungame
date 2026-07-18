import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildMap } from "./pipeline.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface Geometry {
  readonly positions: readonly number[];
  readonly indices: readonly number[];
}

interface MeshEntry {
  readonly name: string;
  readonly geometry: Geometry;
}

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Geometry {
  return {
    positions: [
      minX, minY, minZ, maxX, minY, minZ, maxX, maxY, minZ, minX, maxY, minZ,
      minX, minY, maxZ, maxX, minY, maxZ, maxX, maxY, maxZ, minX, maxY, maxZ,
    ],
    indices: [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
      0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
    ],
  };
}

function ramp(minX: number, z: number, length: number, width: number, height: number): Geometry {
  const maxX = minX + length;
  const minZ = z - width / 2;
  const maxZ = z + width / 2;
  return {
    positions: [
      minX, 0, minZ, minX, 0, maxZ,
      maxX, 0, minZ, maxX, 0, maxZ,
      maxX, height, minZ, maxX, height, maxZ,
    ],
    indices: [
      0, 2, 3, 0, 3, 1,
      0, 4, 2, 0, 5, 4, 0, 1, 5,
      2, 4, 5, 2, 5, 3,
      0, 4, 2, 1, 3, 5,
    ],
  };
}

function floatBytes(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

function uintBytes(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
}

function minMax(positions: readonly number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis] ?? Infinity, positions[index + axis] ?? 0);
      max[axis] = Math.max(max[axis] ?? -Infinity, positions[index + axis] ?? 0);
    }
  }
  return { min, max };
}

async function main(): Promise<void> {
  const meshes: MeshEntry[] = [
    { name: "col_floor", geometry: box(-30, -0.2, -20, 30, 0, 20) },
    { name: "col_wall_north", geometry: box(-30, 0, -20, 30, 4, -19.5) },
    { name: "col_wall_south", geometry: box(-30, 0, 19.5, 30, 4, 20) },
    { name: "col_wall_west", geometry: box(-30, 0, -20, -29.5, 4, 20) },
    { name: "col_wall_east", geometry: box(29.5, 0, -20, 30, 4, 20) },
    { name: "col_ramp_15deg", geometry: ramp(-24, -10, 8, 4, Math.tan(Math.PI / 12) * 8) },
    { name: "col_ramp_30deg", geometry: ramp(-4, -10, 6, 4, Math.tan(Math.PI / 6) * 6) },
    { name: "col_ramp_45deg", geometry: ramp(16, -10, 4, 4, 4) },
    { name: "col_ledge_040", geometry: box(-8, 0, 4, 0, 0.4, 10) },
    { name: "col_tower_west", geometry: box(-25, 0, 7, -20, 5, 13) },
    { name: "col_tower_east", geometry: box(20, 0, 7, 25, 5, 13) },
    { name: "col_tower_west_jumpdeck", geometry: box(-19, 4.5, 8, -13, 5, 12) },
    { name: "col_tower_east_jumpdeck", geometry: box(13, 4.5, 8, 19, 5, 12) },
    { name: "bounds_arena", geometry: box(-30, -4, -20, 30, 12, 20) },
    { name: "kill_void", geometry: box(-35, -6, -25, 35, -3, 25) },
  ];
  for (let step = 0; step < 6; step += 1) {
    meshes.push({
      name: `col_stair_${step}`,
      geometry: box(5 + step * 0.8, 0, 3, 5.8 + step * 0.8, (step + 1) * 0.3, 7),
    });
  }

  const bufferViews: Record<string, number>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const gltfMeshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const chunks: Uint8Array[] = [];
  let byteOffset = 0;

  const addChunk = (bytes: Uint8Array, target: number): number => {
    const index = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target });
    chunks.push(bytes);
    byteOffset += bytes.byteLength;
    return index;
  };

  for (const entry of meshes) {
    const positionView = addChunk(floatBytes(entry.geometry.positions), 34962);
    const indexView = addChunk(uintBytes(entry.geometry.indices), 34963);
    const range = minMax(entry.geometry.positions);
    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count: entry.geometry.positions.length / 3,
      type: "VEC3",
      min: range.min,
      max: range.max,
    });
    const indexAccessor = accessors.length;
    accessors.push({
      bufferView: indexView,
      componentType: 5125,
      count: entry.geometry.indices.length,
      type: "SCALAR",
      min: [Math.min(...entry.geometry.indices)],
      max: [Math.max(...entry.geometry.indices)],
    });
    const mesh = gltfMeshes.length;
    gltfMeshes.push({
      name: entry.name,
      primitives: [{ attributes: { POSITION: positionAccessor }, indices: indexAccessor, mode: 4 }],
    });
    nodes.push({ name: entry.name, mesh });
  }

  const spawnPositions = [
    [-24, 0.05, -14], [-16, 0.05, -14], [-8, 0.05, -14], [0, 0.05, -14],
    [8, 0.05, -14], [16, 0.05, -14], [24, 0.05, -14], [-24, 0.05, 15],
    [-14, 0.05, 15], [-4, 0.05, 15], [8, 0.05, 15], [18, 0.05, 15],
  ] as const;
  for (const mode of [0, 1] as const) {
    spawnPositions.forEach((position, index) => {
      const yaw = index < 7 ? 0 : Math.PI;
      nodes.push({
        name: `spawn_${mode}_${mode === 0 ? index % 2 : 0}_${index.toString().padStart(2, "0")}`,
        translation: position,
        rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
      });
    });
  }

  const binary = new Uint8Array(byteOffset);
  let cursor = 0;
  for (const chunk of chunks) {
    binary.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  const document = {
    asset: { version: "2.0", generator: "gungame programmatic greybox v1" },
    scene: 0,
    scenes: [{ name: "greybox", nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes: gltfMeshes,
    accessors,
    bufferViews,
    buffers: [
      {
        byteLength: binary.byteLength,
        uri: `data:application/octet-stream;base64,${Buffer.from(binary).toString("base64")}`,
      },
    ],
  };

  const mapsDirectory = resolve(PROJECT_ROOT, "maps");
  const gltfPath = resolve(mapsDirectory, "greybox.gltf");
  const blobPath = resolve(mapsDirectory, "greybox.blob");
  await mkdir(mapsDirectory, { recursive: true });
  await writeFile(gltfPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  const map = await buildMap(gltfPath, blobPath);
  console.log(
    `generated maps/greybox.gltf and maps/greybox.blob (${map.collision.indices.length / 3} triangles, ${map.spawns.length} spawns)`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
