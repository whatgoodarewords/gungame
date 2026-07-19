import {
  encodeGameplayMap,
  loadGameplayMap,
  MapSecretKind,
  type GameplayMap,
  type MapAabb,
  type MapSecret,
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
  const secrets: MapSecret[] = [];
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
    } else if (node.name.startsWith("secret_spire_room")) {
      secrets.push({ kind: MapSecretKind.SpireRoom, bounds: nodeAabb(node) });
    } else if (node.name.startsWith("secret_foundry_sigil")) {
      secrets.push({ kind: MapSecretKind.FoundrySigil, bounds: nodeAabb(node) });
    } else if (node.name.startsWith("secret_duna_graffiti_room")) {
      secrets.push({ kind: MapSecretKind.DunaGraffitiRoom, bounds: nodeAabb(node) });
    } else if (node.name.startsWith("secret_cascade_waterfall_room")) {
      secrets.push({ kind: MapSecretKind.CascadeWaterfallRoom, bounds: nodeAabb(node) });
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
      secrets,
    },
    collisionMeshCount,
    hasBoundsNode: bounds !== undefined,
  };
}

export function validateMap(
  map: GameplayMap,
  metadata?: Pick<BakedMap, "collisionMeshCount" | "hasBoundsNode">,
  expectedMap?: "spire" | "foundry" | "duna" | "cascade",
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
  if (map.killVolumes.length < 1) throw new Error("map must declare at least one kill_ volume");
  if (expectedMap === "spire") {
    if (modeCounts.size !== 1 || modeCounts.get(1) !== 24) {
      throw new Error("Spire must declare exactly 24 Scoutzknivez spawns");
    }
    if (map.secrets.filter((secret) => secret.kind === MapSecretKind.SpireRoom).length !== 1) {
      throw new Error("Spire must declare exactly one secret_spire_room node");
    }
  }
  if (expectedMap === "foundry") {
    if (modeCounts.size !== 1 || modeCounts.get(0) !== 16) {
      throw new Error("Foundry must declare exactly 16 Gun Game spawns");
    }
    if (map.secrets.filter((secret) => secret.kind === MapSecretKind.FoundrySigil).length !== 1) {
      throw new Error("Foundry must declare exactly one secret_foundry_sigil node");
    }
  }
  if (expectedMap === "duna") {
    if (modeCounts.size !== 1 || modeCounts.get(0) !== 16) {
      throw new Error("Duna must declare exactly 16 Gun Game spawns");
    }
    if (map.secrets.filter((secret) => secret.kind === MapSecretKind.DunaGraffitiRoom).length !== 1) {
      throw new Error("Duna must declare exactly one secret_duna_graffiti_room node");
    }
  }
  if (expectedMap === "cascade") {
    if (modeCounts.size !== 1 || modeCounts.get(0) !== 16) {
      throw new Error("Cascade must declare exactly 16 Gun Game spawns");
    }
    if (map.secrets.filter((secret) => secret.kind === MapSecretKind.CascadeWaterfallRoom).length !== 1) {
      throw new Error("Cascade must declare exactly one secret_cascade_waterfall_room node");
    }
  }
}

function expectedMapForPath(sourcePath: string): "spire" | "foundry" | "duna" | "cascade" | undefined {
  const lower = sourcePath.toLowerCase();
  if (lower.includes("spire")) return "spire";
  if (lower.includes("foundry")) return "foundry";
  if (lower.includes("duna")) return "duna";
  if (lower.includes("cascade")) return "cascade";
  return undefined;
}

export async function buildMap(sourcePath: string, outputPath: string): Promise<GameplayMap> {
  const baked = await bakeGltf(sourcePath);
  const expected = expectedMapForPath(sourcePath);
  validateMap(baked.map, baked, expected);
  const blob = encodeGameplayMap(baked.map);
  await writeFile(outputPath, new Uint8Array(blob));
  const loaded = loadGameplayMap(await readFile(outputPath));
  validateMap(loaded, undefined, expected);
  return loaded;
}

export async function validatePath(sourcePath: string): Promise<GameplayMap> {
  const expected = expectedMapForPath(sourcePath);
  if (sourcePath.endsWith(".blob")) {
    const map = loadGameplayMap(await readFile(sourcePath));
    validateMap(map, undefined, expected);
    return map;
  }
  const baked = await bakeGltf(sourcePath);
  validateMap(baked.map, baked, expected);
  return baked.map;
}
