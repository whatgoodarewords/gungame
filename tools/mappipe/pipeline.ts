import {
  encodeGameplayMap,
  loadGameplayMap,
  type GameplayMap,
  type MapAabb,
  type MapSpawn,
} from "@gungame/shared";
import { readFile, writeFile } from "node:fs/promises";

import { loadGltfNodes, transformPoint, type GltfNode } from "./gltf.js";

export interface BakedMap {
  readonly map: GameplayMap;
  readonly collisionMeshCount: number;
  readonly hasBoundsNode: boolean;
}

function nodeAabb(node: GltfNode): MapAabb {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let points = 0;
  for (const primitive of node.primitives) {
    for (let offset = 0; offset < primitive.positions.length; offset += 3) {
      const [x, y, z] = transformPoint(
        node.worldMatrix,
        primitive.positions[offset] ?? 0,
        primitive.positions[offset + 1] ?? 0,
        primitive.positions[offset + 2] ?? 0,
      );
      min.x = Math.min(min.x, x);
      min.y = Math.min(min.y, y);
      min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x);
      max.y = Math.max(max.y, y);
      max.z = Math.max(max.z, z);
      points += 1;
    }
  }
  if (points === 0) {
    throw new Error(`${node.name} must reference mesh geometry`);
  }
  return { min, max };
}

export async function bakeGltf(sourcePath: string): Promise<BakedMap> {
  const nodes = await loadGltfNodes(sourcePath);
  const positions: number[] = [];
  const indices: number[] = [];
  const spawns: MapSpawn[] = [];
  const killVolumes: MapAabb[] = [];
  let bounds: MapAabb | undefined;
  let collisionMeshCount = 0;

  for (const node of nodes) {
    if (node.name.startsWith("col_")) {
      collisionMeshCount += 1;
      for (const primitive of node.primitives) {
        const baseVertex = positions.length / 3;
        for (let offset = 0; offset < primitive.positions.length; offset += 3) {
          positions.push(
            ...transformPoint(
              node.worldMatrix,
              primitive.positions[offset] ?? 0,
              primitive.positions[offset + 1] ?? 0,
              primitive.positions[offset + 2] ?? 0,
            ),
          );
        }
        for (const index of primitive.indices) indices.push(baseVertex + index);
      }
    } else if (node.name.startsWith("spawn_")) {
      const match = /^spawn_(\d+)_(\d+)_/.exec(node.name);
      if (match === null) {
        throw new Error(`${node.name}: expected spawn_<mode>_<team>_<label>`);
      }
      const mode = Number(match[1]);
      const team = Number(match[2]);
      if (mode > 255 || team > 255) {
        throw new RangeError(`${node.name}: mode and team must fit in u8`);
      }
      const [x, y, z] = transformPoint(node.worldMatrix, 0, 0, 0);
      const yaw = Math.atan2(node.worldMatrix[8] ?? 0, node.worldMatrix[10] ?? 1);
      spawns.push({ mode, team, position: { x, y, z }, yaw });
    } else if (node.name.startsWith("kill_")) {
      killVolumes.push(nodeAabb(node));
    } else if (node.name.startsWith("bounds_")) {
      if (bounds !== undefined) throw new Error("map declares more than one bounds_ node");
      bounds = nodeAabb(node);
    }
  }

  return {
    map: {
      collision: {
        positions: Float32Array.from(positions),
        indices: Uint32Array.from(indices),
      },
      spawns,
      bounds: bounds ?? {
        min: { x: NaN, y: NaN, z: NaN },
        max: { x: NaN, y: NaN, z: NaN },
      },
      killVolumes,
    },
    collisionMeshCount,
    hasBoundsNode: bounds !== undefined,
  };
}

export function validateMap(
  map: GameplayMap,
  metadata?: Pick<BakedMap, "collisionMeshCount" | "hasBoundsNode">,
): void {
  const collisionCount = metadata?.collisionMeshCount ?? (map.collision.indices.length > 0 ? 1 : 0);
  if (collisionCount < 1 || map.collision.indices.length < 3) {
    throw new Error("map must contain at least one col_ collision mesh");
  }
  if (metadata !== undefined && !metadata.hasBoundsNode) {
    throw new Error("map must contain a bounds_ node");
  }
  const modeCounts = new Map<number, number>();
  for (const spawn of map.spawns) {
    modeCounts.set(spawn.mode, (modeCounts.get(spawn.mode) ?? 0) + 1);
  }
  if (modeCounts.size === 0) throw new Error("map must declare at least one spawn mode");
  for (const [mode, count] of modeCounts) {
    if (count < 8) throw new Error(`mode ${mode} has ${count} spawns; at least 8 required`);
  }
}

export async function buildMap(sourcePath: string, outputPath: string): Promise<GameplayMap> {
  const baked = await bakeGltf(sourcePath);
  validateMap(baked.map, baked);
  const blob = encodeGameplayMap(baked.map);
  await writeFile(outputPath, new Uint8Array(blob));
  const loaded = loadGameplayMap(await readFile(outputPath));
  validateMap(loaded);
  return loaded;
}

export async function validatePath(sourcePath: string): Promise<GameplayMap> {
  if (sourcePath.endsWith(".blob")) {
    const map = loadGameplayMap(await readFile(sourcePath));
    validateMap(map);
    return map;
  }
  const baked = await bakeGltf(sourcePath);
  validateMap(baked.map, baked);
  return baked.map;
}
