import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type JsonObject = Record<string, unknown>;
type Matrix4 = readonly number[];

export interface GltfPrimitive {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export interface GltfNode {
  readonly name: string;
  readonly worldMatrix: Matrix4;
  readonly primitives: readonly GltfPrimitive[];
}

const IDENTITY: Matrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value as number;
}

function numberArray(value: unknown, length: number, label: string): number[] {
  const values = array(value, label);
  if (values.length !== length || values.some((entry) => !Number.isFinite(entry))) {
    throw new TypeError(`${label} must contain ${length} finite numbers`);
  }
  return values as number[];
}

function multiply(a: Matrix4, b: Matrix4): Matrix4 {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += (a[index * 4 + row] ?? 0) * (b[column * 4 + index] ?? 0);
      }
      result[column * 4 + row] = value;
    }
  }
  return result;
}

function nodeMatrix(node: JsonObject): Matrix4 {
  if (node.matrix !== undefined) {
    return numberArray(node.matrix, 16, "node.matrix");
  }
  const translation =
    node.translation === undefined
      ? [0, 0, 0]
      : numberArray(node.translation, 3, "node.translation");
  const rotation =
    node.rotation === undefined
      ? [0, 0, 0, 1]
      : numberArray(node.rotation, 4, "node.rotation");
  const scale =
    node.scale === undefined
      ? [1, 1, 1]
      : numberArray(node.scale, 3, "node.scale");
  const [x = 0, y = 0, z = 0, w = 1] = rotation;
  const [sx = 1, sy = 1, sz = 1] = scale;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  return [
    (1 - (y * y2 + z * z2)) * sx,
    (x * y2 + w * z2) * sx,
    (x * z2 - w * y2) * sx,
    0,
    (x * y2 - w * z2) * sy,
    (1 - (x * x2 + z * z2)) * sy,
    (y * z2 + w * x2) * sy,
    0,
    (x * z2 + w * y2) * sz,
    (y * z2 - w * x2) * sz,
    (1 - (x * x2 + y * y2)) * sz,
    0,
    translation[0] ?? 0,
    translation[1] ?? 0,
    translation[2] ?? 0,
    1,
  ];
}

function decodeDataUri(uri: string): Uint8Array {
  const match = /^data:.*?;base64,(.*)$/.exec(uri);
  if (match === null) {
    throw new Error("only base64 data URIs are supported inline");
  }
  return Uint8Array.from(Buffer.from(match[1] ?? "", "base64"));
}

async function loadBuffers(
  document: JsonObject,
  sourcePath: string,
): Promise<readonly Uint8Array[]> {
  const definitions = array(document.buffers, "buffers");
  return Promise.all(
    definitions.map(async (entry, index) => {
      const definition = object(entry, `buffers[${index}]`);
      if (typeof definition.uri !== "string") {
        throw new Error("GLB buffers are not supported; export a .gltf with buffers");
      }
      const bytes = definition.uri.startsWith("data:")
        ? decodeDataUri(definition.uri)
        : new Uint8Array(await readFile(resolve(dirname(sourcePath), definition.uri)));
      const expected = integer(definition.byteLength, `buffers[${index}].byteLength`);
      if (bytes.byteLength < expected) {
        throw new RangeError(`buffers[${index}] is truncated`);
      }
      return bytes;
    }),
  );
}

interface AccessorInfo {
  readonly view: DataView;
  readonly count: number;
  readonly componentType: number;
  readonly componentBytes: number;
  readonly stride: number;
  readonly components: number;
}

function accessorInfo(
  document: JsonObject,
  buffers: readonly Uint8Array[],
  accessorIndex: number,
): AccessorInfo {
  const accessor = object(
    array(document.accessors, "accessors")[accessorIndex],
    `accessors[${accessorIndex}]`,
  );
  if (accessor.sparse !== undefined) {
    throw new Error("sparse accessors are not supported by mappipe v1");
  }
  const viewIndex = integer(accessor.bufferView, "accessor.bufferView");
  const bufferView = object(
    array(document.bufferViews, "bufferViews")[viewIndex],
    `bufferViews[${viewIndex}]`,
  );
  const bufferIndex = integer(bufferView.buffer, "bufferView.buffer");
  const bytes = buffers[bufferIndex];
  if (bytes === undefined) {
    throw new RangeError(`buffer ${bufferIndex} is missing`);
  }
  const componentType = integer(accessor.componentType, "accessor.componentType");
  const componentBytes =
    componentType === 5121 ? 1 : componentType === 5123 ? 2 : 4;
  if (![5121, 5123, 5125, 5126].includes(componentType)) {
    throw new Error(`unsupported accessor component type ${componentType}`);
  }
  const components = accessor.type === "SCALAR" ? 1 : accessor.type === "VEC3" ? 3 : 0;
  if (components === 0) {
    throw new Error(`unsupported accessor type ${String(accessor.type)}`);
  }
  const baseOffset =
    integer(bufferView.byteOffset ?? 0, "bufferView.byteOffset") +
    integer(accessor.byteOffset ?? 0, "accessor.byteOffset");
  const count = integer(accessor.count, "accessor.count");
  const stride = integer(
    bufferView.byteStride ?? componentBytes * components,
    "bufferView.byteStride",
  );
  return {
    view: new DataView(bytes.buffer, bytes.byteOffset + baseOffset),
    count,
    componentType,
    componentBytes,
    stride,
    components,
  };
}

function readComponent(info: AccessorInfo, byteOffset: number): number {
  if (info.componentType === 5121) return info.view.getUint8(byteOffset);
  if (info.componentType === 5123) return info.view.getUint16(byteOffset, true);
  if (info.componentType === 5125) return info.view.getUint32(byteOffset, true);
  return info.view.getFloat32(byteOffset, true);
}

function readPositions(info: AccessorInfo): Float32Array {
  if (info.componentType !== 5126 || info.components !== 3) {
    throw new Error("POSITION must be a float32 VEC3 accessor");
  }
  const result = new Float32Array(info.count * 3);
  for (let index = 0; index < info.count; index += 1) {
    for (let component = 0; component < 3; component += 1) {
      result[index * 3 + component] = readComponent(
        info,
        index * info.stride + component * info.componentBytes,
      );
    }
  }
  return result;
}

function readIndices(info: AccessorInfo): Uint32Array {
  if (info.components !== 1 || info.componentType === 5126) {
    throw new Error("indices must be an unsigned integer SCALAR accessor");
  }
  const result = new Uint32Array(info.count);
  for (let index = 0; index < info.count; index += 1) {
    result[index] = readComponent(info, index * info.stride);
  }
  return result;
}

export async function loadGltfNodes(sourcePath: string): Promise<readonly GltfNode[]> {
  if (!sourcePath.endsWith(".gltf")) {
    throw new Error("mappipe v1 accepts JSON .gltf files (not .glb)");
  }
  const document = object(
    JSON.parse(await readFile(sourcePath, "utf8")) as unknown,
    "glTF",
  );
  const buffers = await loadBuffers(document, sourcePath);
  const nodeDefinitions = array(document.nodes, "nodes");
  const meshDefinitions = array(document.meshes ?? [], "meshes");
  const sceneIndex = integer(document.scene ?? 0, "scene");
  const scene = object(array(document.scenes, "scenes")[sceneIndex], `scenes[${sceneIndex}]`);
  const roots = array(scene.nodes, "scene.nodes").map((value, index) =>
    integer(value, `scene.nodes[${index}]`),
  );
  const result: GltfNode[] = [];

  const visit = (nodeIndex: number, parent: Matrix4): void => {
    const definition = object(nodeDefinitions[nodeIndex], `nodes[${nodeIndex}]`);
    const worldMatrix = multiply(parent, nodeMatrix(definition));
    const primitives: GltfPrimitive[] = [];
    if (definition.mesh !== undefined) {
      const meshIndex = integer(definition.mesh, `nodes[${nodeIndex}].mesh`);
      const mesh = object(meshDefinitions[meshIndex], `meshes[${meshIndex}]`);
      for (const [primitiveIndex, primitiveValue] of array(
        mesh.primitives,
        `meshes[${meshIndex}].primitives`,
      ).entries()) {
        const primitive = object(primitiveValue, `primitive[${primitiveIndex}]`);
        if (primitive.mode !== undefined && primitive.mode !== 4) {
          throw new Error("collision primitives must use TRIANGLES mode");
        }
        const attributes = object(primitive.attributes, "primitive.attributes");
        const positionAccessor = integer(attributes.POSITION, "attributes.POSITION");
        const positions = readPositions(
          accessorInfo(document, buffers, positionAccessor),
        );
        const indices =
          primitive.indices === undefined
            ? Uint32Array.from({ length: positions.length / 3 }, (_, index) => index)
            : readIndices(
                accessorInfo(
                  document,
                  buffers,
                  integer(primitive.indices, "primitive.indices"),
                ),
              );
        primitives.push({ positions, indices });
      }
    }
    result.push({
      name: typeof definition.name === "string" ? definition.name : `node_${nodeIndex}`,
      worldMatrix,
      primitives,
    });
    for (const [childIndex, value] of array(definition.children ?? [], "node.children").entries()) {
      visit(integer(value, `node.children[${childIndex}]`), worldMatrix);
    }
  };
  roots.forEach((root) => visit(root, IDENTITY));
  return result;
}

export function transformPoint(matrix: Matrix4, x: number, y: number, z: number): [number, number, number] {
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0),
  ];
}
