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
  readonly collisionTriangleOwners: readonly string[];
  readonly hasBoundsNode: boolean;
}

export const COPLANAR_OVERLAP_TOLERANCE_M = 0.001;

interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Point2 {
  readonly x: number;
  readonly y: number;
}

interface Triangle {
  readonly points: readonly [Point3, Point3, Point3];
  readonly normal: Point3;
  readonly plane: number;
  readonly min: Point3;
  readonly max: Point3;
  readonly projectionAxis: "x" | "y" | "z";
}

function subtract(left: Point3, right: Point3): Point3 {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function dot(left: Point3, right: Point3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: Point3, right: Point3): Point3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function triangleAt(
  positions: Float32Array,
  indices: Uint32Array,
  triangleIndex: number,
): Triangle | undefined {
  const points = Array.from({ length: 3 }, (_, corner): Point3 => {
    const vertex = indices[triangleIndex * 3 + corner] ?? 0;
    return {
      x: positions[vertex * 3] ?? 0,
      y: positions[vertex * 3 + 1] ?? 0,
      z: positions[vertex * 3 + 2] ?? 0,
    };
  }) as unknown as [Point3, Point3, Point3];
  const rawNormal = cross(subtract(points[1], points[0]), subtract(points[2], points[0]));
  const length = Math.hypot(rawNormal.x, rawNormal.y, rawNormal.z);
  if (length < 1e-9) return undefined;
  const normal = {
    x: rawNormal.x / length,
    y: rawNormal.y / length,
    z: rawNormal.z / length,
  };
  const absolute = {
    x: Math.abs(normal.x),
    y: Math.abs(normal.y),
    z: Math.abs(normal.z),
  };
  const projectionAxis = absolute.x >= absolute.y && absolute.x >= absolute.z
    ? "x"
    : absolute.y >= absolute.z
      ? "y"
      : "z";
  return {
    points,
    normal,
    plane: dot(normal, points[0]),
    min: {
      x: Math.min(...points.map((point) => point.x)),
      y: Math.min(...points.map((point) => point.y)),
      z: Math.min(...points.map((point) => point.z)),
    },
    max: {
      x: Math.max(...points.map((point) => point.x)),
      y: Math.max(...points.map((point) => point.y)),
      z: Math.max(...points.map((point) => point.z)),
    },
    projectionAxis,
  };
}

function project(point: Point3, axis: Triangle["projectionAxis"]): Point2 {
  if (axis === "x") return { x: point.y, y: point.z };
  if (axis === "y") return { x: point.x, y: point.z };
  return { x: point.x, y: point.y };
}

function cross2(left: Point2, right: Point2): number {
  return left.x * right.y - left.y * right.x;
}

function subtract2(left: Point2, right: Point2): Point2 {
  return { x: left.x - right.x, y: left.y - right.y };
}

function signedArea(points: readonly Point2[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += current.x * next.y - current.y * next.x;
  }
  return twiceArea / 2;
}

function lineIntersection(start: Point2, end: Point2, clipA: Point2, clipB: Point2): Point2 {
  const subject = subtract2(end, start);
  const clip = subtract2(clipB, clipA);
  const denominator = cross2(subject, clip);
  if (Math.abs(denominator) < 1e-12) return end;
  const t = cross2(subtract2(clipA, start), clip) / denominator;
  return { x: start.x + subject.x * t, y: start.y + subject.y * t };
}

function overlapArea(left: Triangle, right: Triangle): number {
  let polygon = left.points.map((point) => project(point, left.projectionAxis));
  const clip = right.points.map((point) => project(point, left.projectionAxis));
  const orientation = Math.sign(signedArea(clip)) || 1;
  for (let edge = 0; edge < 3 && polygon.length > 0; edge += 1) {
    const clipA = clip[edge]!;
    const clipB = clip[(edge + 1) % 3]!;
    const input = polygon;
    polygon = [];
    for (let index = 0; index < input.length; index += 1) {
      const start = input[index]!;
      const end = input[(index + 1) % input.length]!;
      const startInside = orientation *
        cross2(subtract2(clipB, clipA), subtract2(start, clipA)) >= -1e-10;
      const endInside = orientation *
        cross2(subtract2(clipB, clipA), subtract2(end, clipA)) >= -1e-10;
      if (startInside && endInside) {
        polygon.push(end);
      } else if (startInside) {
        polygon.push(lineIntersection(start, end, clipA, clipB));
      } else if (endInside) {
        polygon.push(lineIntersection(start, end, clipA, clipB), end);
      }
    }
  }
  return polygon.length < 3 ? 0 : Math.abs(signedArea(polygon));
}

function aabbsNear(left: Triangle, right: Triangle, tolerance: number): boolean {
  return left.min.x <= right.max.x + tolerance && left.max.x + tolerance >= right.min.x &&
    left.min.y <= right.max.y + tolerance && left.max.y + tolerance >= right.min.y &&
    left.min.z <= right.max.z + tolerance && left.max.z + tolerance >= right.min.z;
}

export function validateNoParallelCoplanarOverlap(
  collision: GameplayMap["collision"],
  tolerance = COPLANAR_OVERLAP_TOLERANCE_M,
  triangleOwners?: readonly string[],
): void {
  const triangleCount = Math.floor(collision.indices.length / 3);
  const triangles = Array.from(
    { length: triangleCount },
    (_, index) => triangleAt(collision.positions, collision.indices, index),
  );
  for (let leftIndex = 0; leftIndex < triangles.length; leftIndex += 1) {
    const left = triangles[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < triangles.length; rightIndex += 1) {
      if (
        triangleOwners !== undefined &&
        triangleOwners[leftIndex] === triangleOwners[rightIndex]
      ) continue;
      const right = triangles[rightIndex];
      if (right === undefined || !aabbsNear(left, right, tolerance)) continue;
      // Opposite-facing coincident faces are sealed internal boundaries. The
      // renderer can only expose one side at a time; same-facing sheets are
      // the depth-ambiguous surfaces that visibly z-fight.
      if (dot(left.normal, right.normal) < 1 - 1e-6) continue;
      if (right.points.some((point) =>
        Math.abs(dot(left.normal, point) - left.plane) > tolerance)) continue;
      if (overlapArea(left, right) <= 1e-8) continue;
      throw new Error(
        `parallel-coplanar overlap within ${tolerance} m between triangles ` +
        `${leftIndex}${triangleOwners?.[leftIndex] === undefined ? "" : ` (${triangleOwners[leftIndex]})`} and ` +
        `${rightIndex}${triangleOwners?.[rightIndex] === undefined ? "" : ` (${triangleOwners[rightIndex]})`}`,
      );
    }
  }
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
  const collisionTriangleOwners: string[] = [];

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
        for (let index = 0; index < primitive.indices.length / 3; index += 1) {
          collisionTriangleOwners.push(node.name);
        }
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
    } else if (node.name.startsWith("secret_race_spot")) {
      secrets.push({ kind: MapSecretKind.RaceSpot, bounds: nodeAabb(node) });
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
    collisionTriangleOwners,
    hasBoundsNode: bounds !== undefined,
  };
}

export function validateMap(
  map: GameplayMap,
  metadata?: Pick<
    BakedMap,
    "collisionMeshCount" | "collisionTriangleOwners" | "hasBoundsNode"
  >,
  expectedMap?: "spire" | "foundry" | "duna" | "cascade",
): void {
  const collisionCount = metadata?.collisionMeshCount ?? (map.collision.indices.length > 0 ? 1 : 0);
  if (collisionCount < 1 || map.collision.indices.length < 3) {
    throw new Error("map must contain at least one col_ collision mesh");
  }
  validateNoParallelCoplanarOverlap(
    map.collision,
    COPLANAR_OVERLAP_TOLERANCE_M,
    metadata?.collisionTriangleOwners,
  );
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
  if (expectedMap !== undefined) {
    const raceSpots = map.secrets.filter((secret) => secret.kind === MapSecretKind.RaceSpot).length;
    if (raceSpots < 1 || raceSpots > 2) {
      throw new Error(`${expectedMap} must declare one or two secret_race_spot nodes`);
    }
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
