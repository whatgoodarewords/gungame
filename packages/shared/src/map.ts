import type { Vec3 } from "./math.js";

export const MAP_BLOB_MAGIC = "GGMP" as const;
export const MAP_BLOB_VERSION = 2 as const;

const V1_HEADER_BYTES = 24;
const HEADER_BYTES = 28;
const SPAWN_BYTES = 18;
const AABB_BYTES = 24;
const SECRET_BYTES = 28;

export const MapSecretKind = {
  SpireRoom: 1,
  FoundrySigil: 2,
  DunaGraffitiRoom: 3,
  CascadeWaterfallRoom: 4,
} as const;

export type MapSecretKindValue = typeof MapSecretKind[keyof typeof MapSecretKind];

export interface MapCollision {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export interface MapSpawn {
  readonly mode: number;
  readonly team: number;
  readonly position: Vec3;
  readonly yaw: number;
}

export interface MapAabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface MapSecret {
  readonly kind: MapSecretKindValue;
  readonly bounds: MapAabb;
}

export interface GameplayMap {
  readonly collision: MapCollision;
  readonly spawns: readonly MapSpawn[];
  readonly bounds: MapAabb;
  readonly killVolumes: readonly MapAabb[];
  readonly secrets: readonly MapSecret[];
}

function assertU8(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${label} must be an unsigned byte`);
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

function assertAabb(bounds: MapAabb, label: string): void {
  for (const axis of ["x", "y", "z"] as const) {
    assertFinite(bounds.min[axis], `${label}.min.${axis}`);
    assertFinite(bounds.max[axis], `${label}.max.${axis}`);
    if (bounds.min[axis] > bounds.max[axis]) {
      throw new RangeError(`${label}.min.${axis} exceeds max.${axis}`);
    }
  }
}

function byteLengthFor(
  positionCount: number,
  indexCount: number,
  spawnCount: number,
  killVolumeCount: number,
  secretCount: number,
): number {
  return (
    HEADER_BYTES +
    positionCount * 4 +
    indexCount * 4 +
    spawnCount * SPAWN_BYTES +
    AABB_BYTES +
    killVolumeCount * AABB_BYTES +
    secretCount * SECRET_BYTES
  );
}

function writeVec3(view: DataView, offset: number, value: Vec3): number {
  view.setFloat32(offset, value.x, true);
  view.setFloat32(offset + 4, value.y, true);
  view.setFloat32(offset + 8, value.z, true);
  return offset + 12;
}

function readVec3(view: DataView, offset: number): Vec3 {
  return {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true),
    z: view.getFloat32(offset + 8, true),
  };
}

export function encodeGameplayMap(map: GameplayMap): ArrayBuffer {
  if (map.collision.positions.length % 3 !== 0) {
    throw new RangeError("collision positions must contain xyz triples");
  }
  if (map.collision.indices.length % 3 !== 0) {
    throw new RangeError("collision indices must contain triangle triples");
  }

  const vertexCount = map.collision.positions.length / 3;
  for (const [index, value] of map.collision.positions.entries()) {
    assertFinite(value, `collision.positions[${index}]`);
  }
  for (const [index, value] of map.collision.indices.entries()) {
    if (value >= vertexCount) {
      throw new RangeError(`collision.indices[${index}] is out of range`);
    }
  }
  for (const [index, spawn] of map.spawns.entries()) {
    assertU8(spawn.mode, `spawns[${index}].mode`);
    assertU8(spawn.team, `spawns[${index}].team`);
    assertFinite(spawn.position.x, `spawns[${index}].position.x`);
    assertFinite(spawn.position.y, `spawns[${index}].position.y`);
    assertFinite(spawn.position.z, `spawns[${index}].position.z`);
    assertFinite(spawn.yaw, `spawns[${index}].yaw`);
  }
  assertAabb(map.bounds, "bounds");
  map.killVolumes.forEach((volume, index) => {
    assertAabb(volume, `killVolumes[${index}]`);
  });
  map.secrets.forEach((secret, index) => {
    assertU8(secret.kind, `secrets[${index}].kind`);
    assertAabb(secret.bounds, `secrets[${index}].bounds`);
  });

  const buffer = new ArrayBuffer(
    byteLengthFor(
      map.collision.positions.length,
      map.collision.indices.length,
      map.spawns.length,
      map.killVolumes.length,
      map.secrets.length,
    ),
  );
  new Uint8Array(buffer).set([0x47, 0x47, 0x4d, 0x50], 0);
  const view = new DataView(buffer);
  view.setUint32(4, MAP_BLOB_VERSION, true);
  view.setUint32(8, map.collision.positions.length, true);
  view.setUint32(12, map.collision.indices.length, true);
  view.setUint32(16, map.spawns.length, true);
  view.setUint32(20, map.killVolumes.length, true);
  view.setUint32(24, map.secrets.length, true);

  let offset = HEADER_BYTES;
  new Float32Array(buffer, offset, map.collision.positions.length).set(
    map.collision.positions,
  );
  offset += map.collision.positions.byteLength;
  new Uint32Array(buffer, offset, map.collision.indices.length).set(
    map.collision.indices,
  );
  offset += map.collision.indices.byteLength;

  for (const spawn of map.spawns) {
    view.setUint8(offset, spawn.mode);
    view.setUint8(offset + 1, spawn.team);
    offset = writeVec3(view, offset + 2, spawn.position);
    view.setFloat32(offset, spawn.yaw, true);
    offset += 4;
  }
  offset = writeVec3(view, offset, map.bounds.min);
  offset = writeVec3(view, offset, map.bounds.max);
  for (const volume of map.killVolumes) {
    offset = writeVec3(view, offset, volume.min);
    offset = writeVec3(view, offset, volume.max);
  }
  for (const secret of map.secrets) {
    view.setUint8(offset, secret.kind);
    view.setUint8(offset + 1, 0);
    view.setUint16(offset + 2, 0, true);
    offset = writeVec3(view, offset + 4, secret.bounds.min);
    offset = writeVec3(view, offset, secret.bounds.max);
  }
  return buffer;
}

export function loadGameplayMap(source: ArrayBuffer | Uint8Array): GameplayMap {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  if (buffer.byteLength < V1_HEADER_BYTES) {
    throw new RangeError("map blob is shorter than its header");
  }

  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== MAP_BLOB_MAGIC) {
    throw new Error(`invalid map magic ${JSON.stringify(magic)}`);
  }
  const view = new DataView(buffer);
  const version = view.getUint32(4, true);
  if (version !== 1 && version !== MAP_BLOB_VERSION) {
    throw new Error(`unsupported map version ${version}`);
  }

  const positionCount = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  const spawnCount = view.getUint32(16, true);
  const killVolumeCount = view.getUint32(20, true);
  const secretCount = version >= 2 ? view.getUint32(24, true) : 0;
  if (positionCount % 3 !== 0 || indexCount % 3 !== 0) {
    throw new RangeError("collision counts must describe xyz vertices and triangles");
  }
  const headerBytes = version >= 2 ? HEADER_BYTES : V1_HEADER_BYTES;
  const expectedBytes = version >= 2
    ? byteLengthFor(positionCount, indexCount, spawnCount, killVolumeCount, secretCount)
    : V1_HEADER_BYTES + positionCount * 4 + indexCount * 4 +
      spawnCount * SPAWN_BYTES + AABB_BYTES + killVolumeCount * AABB_BYTES;
  if (buffer.byteLength !== expectedBytes) {
    throw new RangeError(
      `map blob length ${buffer.byteLength} does not match header ${expectedBytes}`,
    );
  }

  let offset = headerBytes;
  const positions = new Float32Array(buffer, offset, positionCount);
  offset += positions.byteLength;
  const indices = new Uint32Array(buffer, offset, indexCount);
  offset += indices.byteLength;
  const vertexCount = positionCount / 3;
  for (const [index, value] of positions.entries()) {
    assertFinite(value, `collision.positions[${index}]`);
  }
  for (const [index, value] of indices.entries()) {
    if (value >= vertexCount) {
      throw new RangeError(`collision.indices[${index}] is out of range`);
    }
  }

  const spawns: MapSpawn[] = [];
  for (let index = 0; index < spawnCount; index += 1) {
    const spawn = {
      mode: view.getUint8(offset),
      team: view.getUint8(offset + 1),
      position: readVec3(view, offset + 2),
      yaw: view.getFloat32(offset + 14, true),
    };
    assertFinite(spawn.position.x, `spawns[${index}].position.x`);
    assertFinite(spawn.position.y, `spawns[${index}].position.y`);
    assertFinite(spawn.position.z, `spawns[${index}].position.z`);
    assertFinite(spawn.yaw, `spawns[${index}].yaw`);
    spawns.push(spawn);
    offset += SPAWN_BYTES;
  }
  const bounds = {
    min: readVec3(view, offset),
    max: readVec3(view, offset + 12),
  };
  assertAabb(bounds, "bounds");
  offset += AABB_BYTES;
  const killVolumes: MapAabb[] = [];
  for (let index = 0; index < killVolumeCount; index += 1) {
    const volume = {
      min: readVec3(view, offset),
      max: readVec3(view, offset + 12),
    };
    assertAabb(volume, `killVolumes[${index}]`);
    killVolumes.push(volume);
    offset += AABB_BYTES;
  }
  const secrets: MapSecret[] = [];
  for (let index = 0; index < secretCount; index += 1) {
    const kind = view.getUint8(offset) as MapSecretKindValue;
    const secret = {
      kind,
      bounds: {
        min: readVec3(view, offset + 4),
        max: readVec3(view, offset + 16),
      },
    };
    assertU8(secret.kind, `secrets[${index}].kind`);
    assertAabb(secret.bounds, `secrets[${index}].bounds`);
    secrets.push(secret);
    offset += SECRET_BYTES;
  }
  return { collision: { positions, indices }, spawns, bounds, killVolumes, secrets };
}
