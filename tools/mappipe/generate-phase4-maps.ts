import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildMap } from "./pipeline.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEG = Math.PI / 180;

interface Geometry {
  readonly positions: readonly number[];
  readonly indices: readonly number[];
}

interface MeshEntry {
  readonly name: string;
  readonly geometry: Geometry;
}

interface SpawnEntry {
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly yaw: number;
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Geometry {
  return {
    positions: [
      x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
      x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
    ],
    indices: [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
      0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
    ],
  };
}

/** Solid ramp rising along +X. Its top face is the authored angle. */
function rampX(x0: number, y0: number, z0: number, length: number, width: number, angleDeg: number): Geometry {
  const x1 = x0 + length;
  const z1 = z0 + width;
  const y1 = y0 + Math.tan(angleDeg * DEG) * length;
  return {
    positions: [
      x0, y0, z0, x0, y0, z1,
      x1, y0, z0, x1, y0, z1,
      x1, y1, z0, x1, y1, z1,
    ],
    indices: [
      0, 4, 5, 0, 5, 1,
      0, 2, 4, 0, 3, 2, 0, 1, 3,
      2, 3, 5, 2, 5, 4,
      0, 4, 2, 1, 5, 3,
    ],
  };
}

/** Solid ribbon rising from z0 toward z0 + direction*run. */
function rampZ(
  x0: number,
  x1: number,
  y0: number,
  z0: number,
  direction: -1 | 1,
  run: number,
  angleDeg: number,
): Geometry {
  const z1 = z0 + direction * run;
  const y1 = y0 + Math.tan(angleDeg * DEG) * run;
  return {
    positions: [
      x0, y0, z0, x1, y0, z0,
      x0, y0, z1, x1, y0, z1,
      x0, y1, z1, x1, y1, z1,
    ],
    indices: [
      0, 1, 5, 0, 5, 4,
      0, 2, 3, 0, 3, 1,
      2, 4, 5, 2, 5, 3,
      0, 4, 2, 1, 3, 5,
      0, 1, 3, 0, 3, 2,
    ],
  };
}

function facingOrigin(x: number, z: number): number {
  return Math.atan2(x, z);
}

function spire(): { meshes: MeshEntry[]; spawns: SpawnEntry[] } {
  const meshes: MeshEntry[] = [
    // 80 x 50 m footprint, 40 m authored bounds. The four floor slabs leave
    // the only hard hazard, a narrow 4 x 16 m centre trench, physically open.
    { name: "col_floor_west", geometry: box(-40, -0.35, -25, -2, 0, 25) },
    { name: "col_floor_east", geometry: box(2, -0.35, -25, 40, 0, 25) },
    { name: "col_floor_trench_north", geometry: box(-2, -0.35, -25, 2, 0, -8) },
    { name: "col_floor_trench_south", geometry: box(-2, -0.35, 8, 2, 0, 25) },
    { name: "kill_center_trench", geometry: box(-2, -6, -8, 2, -0.1, 8) },
    { name: "bounds_spire", geometry: box(-40, -7, -32, 40, 40, 25) },
    { name: "col_wall_west", geometry: box(-40, 0, -25, -39.4, 40, 25) },
    { name: "col_wall_east", geometry: box(39.4, 0, -25, 40, 40, 25) },
    { name: "col_wall_south", geometry: box(-40, 0, 24.4, 40, 40, 25) },
    // North wall is split around the strafe-chain entrance to the secret room.
    { name: "col_wall_north_west", geometry: box(-40, 0, -25, 20, 40, -24.4) },
    { name: "col_wall_north_east", geometry: box(25, 0, -25, 40, 40, -24.4) },
    { name: "col_surf_ribbon_north_50deg", geometry: rampZ(-28, 28, 4, -24.4, 1, 5, 50) },
    { name: "col_surf_ribbon_south_50deg", geometry: rampZ(-28, 28, 4, 24.4, -1, 5, 50) },
    // Central spire: a single exposed mass with the exact 22 m highest perch.
    { name: "col_spire_base", geometry: box(-5, 0, -5, 5, 8, 5) },
    { name: "col_spire_mid", geometry: box(-3.6, 8, -3.6, 3.6, 15, 3.6) },
    { name: "col_spire_perch_22m", geometry: box(-2.2, 15, -2.2, 2.2, 22, 2.2) },
    { name: "col_flanking_fin_north_8m", geometry: box(-12, 0, -17, 12, 8, -13) },
    { name: "col_flanking_fin_south_8m", geometry: box(-12, 0, 13, 12, 8, 17) },
    // Secret strafe chain, room shell, and names-wall texture hook surface.
    { name: "col_secret_ledge_a", geometry: box(14, 13.6, -24.3, 18, 14, -22.8) },
    { name: "col_secret_ledge_b", geometry: box(19, 16.6, -24.3, 23, 17, -22.8) },
    { name: "col_secret_room_floor", geometry: box(20, 16.6, -32, 31, 17, -25) },
    { name: "col_secret_room_back", geometry: box(20, 17, -32, 31, 23, -31.5) },
    { name: "col_secret_room_west", geometry: box(20, 17, -32, 20.5, 23, -25) },
    { name: "col_secret_room_east", geometry: box(30.5, 17, -32, 31, 23, -25) },
    { name: "col_names_wall_texture_hook", geometry: box(21, 18, -31.45, 30, 22, -31.35) },
    { name: "secret_spire_room_names_wall", geometry: box(20.6, 17, -31.4, 30.4, 22.8, -25.1) },
  ];

  // Three stepped tiers at each end: 10, 11, and 12 m, four spawns each.
  for (const side of [-1, 1] as const) {
    const team = side < 0 ? 1 : 2;
    const xEdge = side < 0 ? -39 : 27;
    for (let tier = 0; tier < 3; tier += 1) {
      const x0 = side < 0 ? xEdge + tier * 3 : xEdge - tier * 3;
      meshes.push({
        name: `col_organ_loft_t${team}_tier_${tier + 1}_${10 + tier}m`,
        geometry: box(x0, 0, -15, x0 + 12, 10 + tier, 15),
      });
    }
  }

  const spawns: SpawnEntry[] = [];
  for (const team of [1, 2] as const) {
    const side = team === 1 ? -1 : 1;
    for (let tier = 0; tier < 3; tier += 1) {
      const x = side * (34 - tier * 3);
      for (let lane = 0; lane < 4; lane += 1) {
        const z = -10.5 + lane * 7;
        spawns.push({
          name: `spawn_1_${team}_loft_${tier + 1}_${lane + 1}`,
          position: [x, 10.05 + tier, z],
          yaw: facingOrigin(x, z),
        });
      }
    }
  }
  return { meshes, spawns };
}

function foundry(): { meshes: MeshEntry[]; spawns: SpawnEntry[] } {
  const meshes: MeshEntry[] = [
    { name: "bounds_foundry", geometry: box(-22.5, -5, -22.5, 22.5, 18, 22.5) },
    { name: "kill_foundry_void", geometry: box(-25, -5, -25, 25, -3.2, 25) },
    { name: "col_wall_north", geometry: box(-22.5, 0, -22.5, 22.5, 18, -22) },
    { name: "col_wall_south", geometry: box(-22.5, 0, 22, 22.5, 18, 22.5) },
    { name: "col_wall_west", geometry: box(-22.5, 0, -22.5, -22, 18, 22.5) },
    { name: "col_wall_east", geometry: box(22, 0, -22.5, 22.5, 18, 22.5) },
    // Outer arena floor around the 16 x 16 crucible opening; pit floor is 2 m down.
    { name: "col_floor_north", geometry: box(-22, -0.3, -22, 22, 0, -8) },
    { name: "col_floor_south", geometry: box(-22, -0.3, 8, 22, 0, 22) },
    { name: "col_floor_west", geometry: box(-22, -0.3, -8, -8, 0, 8) },
    { name: "col_floor_east", geometry: box(8, -0.3, -8, 22, 0, 8) },
    { name: "col_crucible_pit", geometry: box(-8, -2.35, -8, 8, -2, 8) },
    { name: "col_pit_ramp_west", geometry: rampX(-8, -2, -5, 5, 4, 21.801409) },
    { name: "col_pit_ramp_east", geometry: rampX(3, -2, 1, 5, 4, 21.801409) },
    { name: "col_pit_jump_ramp_30deg", geometry: rampX(-3.464102, -2, -1.5, 3.464102, 3, 30) },
    // 47° surf wedge: exactly named and computed against the 45.57° threshold.
    { name: "col_pit_surf_wedge_47deg", geometry: rampZ(4, 8, -2, 8, 1, 4.2, 47) },
    // Broken catwalk ring at y=4, with gaps aligned to all three pit exits.
    { name: "col_catwalk_north_w", geometry: box(-14, 0, -14, -3, 4, -10) },
    { name: "col_catwalk_north_e", geometry: box(3, 0, -14, 14, 4, -10) },
    { name: "col_catwalk_south_w", geometry: box(-14, 0, 10, -3, 4, 14) },
    { name: "col_catwalk_south_e", geometry: box(3, 0, 10, 14, 4, 14) },
    { name: "col_catwalk_west_n", geometry: box(-14, 0, -10, -10, 4, -2) },
    { name: "col_catwalk_west_s", geometry: box(-14, 0, 2, -10, 4, 10) },
    { name: "col_catwalk_east_n", geometry: box(10, 0, -10, 14, 4, -2) },
    { name: "col_catwalk_east_s", geometry: box(10, 0, 2, 14, 4, 10) },
    // Pillar clusters break the full-circle rifle lane.
    { name: "col_pillar_cluster_nw_a", geometry: box(-12.5, 4, -12.5, -10.5, 11, -10.5) },
    { name: "col_pillar_cluster_nw_b", geometry: box(-9.5, 4, -12.5, -7.5, 9, -10.5) },
    { name: "col_pillar_cluster_se_a", geometry: box(10.5, 4, 10.5, 12.5, 11, 12.5) },
    { name: "col_pillar_cluster_se_b", geometry: box(7.5, 4, 10.5, 9.5, 9, 12.5) },
    // Side halls form the two lobes of the figure eight and block direct pit views.
    { name: "col_hall_west_inner", geometry: box(-20, 0, -5, -15, 5, 5) },
    { name: "col_hall_east_inner", geometry: box(15, 0, -5, 20, 5, 5) },
    { name: "col_hall_west_divider", geometry: box(-19, 0, -1, -14, 3, 1) },
    { name: "col_hall_east_divider", geometry: box(14, 0, -1, 19, 3, 1) },
  ];

  // A 0.4 m ledge stack in each side hall, one on every main figure-eight route.
  for (const side of [-1, 1] as const) {
    for (let step = 0; step < 4; step += 1) {
      const x0 = side < 0 ? -21 + step * 1.1 : 16.6 + step * 1.1;
      meshes.push({
        name: `col_hall_${side < 0 ? "west" : "east"}_ledge_040_${step + 1}`,
        geometry: box(x0, 0, 7, x0 + 1, (step + 1) * 0.4, 11),
      });
    }
  }

  // Knifeable sigil is a thin physical plate behind the NW pillar. Its secret
  // node is metadata only and shares the plate bounds for server ray validation.
  meshes.push(
    { name: "col_foundry_gg_sigil", geometry: box(-12.55, 5.2, -10.2, -10.45, 7.3, -10.05) },
    { name: "secret_foundry_sigil_gg", geometry: box(-12.55, 5.2, -10.2, -10.45, 7.3, -10.05) },
  );

  const positions: Array<readonly [number, number, number]> = [
    [-18, 0.05, -16], [-9, 4.05, -12], [0, 0.05, -18], [9, 4.05, -12],
    [18, 0.05, -16], [17, 0.05, -7], [13, 4.05, 3], [18, 0.05, 14],
    [7, 4.05, 12], [0, -1.95, 5], [-7, 4.05, 12], [-18, 0.05, 14],
    [-13, 4.05, 3], [-17, 0.05, -7], [-5, -1.95, -4], [5, -1.95, -4],
  ];
  const spawns = positions.map(([x, y, z], index): SpawnEntry => ({
    name: `spawn_0_0_ffa_${String(index + 1).padStart(2, "0")}`,
    position: [x, y, z],
    yaw: facingOrigin(x, z),
  }));
  return { meshes, spawns };
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

function minMax(values: readonly number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < values.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis] ?? Infinity, values[index + axis] ?? 0);
      max[axis] = Math.max(max[axis] ?? -Infinity, values[index + axis] ?? 0);
    }
  }
  return { min, max };
}

async function emit(name: "spire" | "foundry", data: ReturnType<typeof spire>): Promise<void> {
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
  for (const entry of data.meshes) {
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
  for (const spawnEntry of data.spawns) {
    nodes.push({
      name: spawnEntry.name,
      translation: spawnEntry.position,
      rotation: [0, Math.sin(spawnEntry.yaw / 2), 0, Math.cos(spawnEntry.yaw / 2)],
    });
  }
  const binary = new Uint8Array(byteOffset);
  let cursor = 0;
  for (const chunk of chunks) {
    binary.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  const document = {
    asset: { version: "2.0", generator: `gungame ${name} programmatic v1` },
    scene: 0,
    scenes: [{ name, nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes: gltfMeshes,
    accessors,
    bufferViews,
    buffers: [{
      byteLength: binary.byteLength,
      uri: `data:application/octet-stream;base64,${Buffer.from(binary).toString("base64")}`,
    }],
  };
  const directory = resolve(ROOT, "maps");
  await mkdir(directory, { recursive: true });
  const gltfPath = resolve(directory, `${name}.gltf`);
  const blobPath = resolve(directory, `${name}.blob`);
  await writeFile(gltfPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  const map = await buildMap(gltfPath, blobPath);
  console.log(
    `${name}: ${map.collision.indices.length / 3} triangles, ` +
    `${map.spawns.length} spawns, ${map.killVolumes.length} kill volumes, ${map.secrets.length} secrets`,
  );
}

await emit("spire", spire());
await emit("foundry", foundry());
