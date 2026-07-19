import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Scene,
  Vector3,
  type Material,
} from "three/webgpu";

import { MapId } from "../../packages/protocol/src/index.js";

interface DressingPlacement {
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly yaw?: number;
}

const DRESSING: Readonly<Record<number, {
  readonly crates: readonly DressingPlacement[];
  readonly pillars: readonly DressingPlacement[];
  readonly rails: readonly DressingPlacement[];
}>> = Object.freeze({
  [MapId.Foundry]: {
    crates: [
      { position: [-15, 0.6, -14], scale: [1.2, 1.2, 1.2], yaw: 0.12 },
      { position: [15, 0.6, 14], scale: [1.2, 1.2, 1.2], yaw: -0.18 },
      { position: [-16.2, 0.45, -13.2], scale: [0.9, 0.9, 0.9], yaw: 0.3 },
    ],
    pillars: [
      { position: [-18, 2, 15], scale: [0.8, 4, 0.8] },
      { position: [18, 2, -15], scale: [0.8, 4, 0.8] },
    ],
    rails: [
      { position: [0, 2.25, -19], scale: [12, 0.12, 0.12] },
      { position: [0, 2.25, 19], scale: [12, 0.12, 0.12] },
    ],
  },
  [MapId.Spire]: {
    crates: [
      { position: [-12, 0.55, 10], scale: [1.1, 1.1, 1.1], yaw: 0.2 },
      { position: [12, 0.55, -10], scale: [1.1, 1.1, 1.1], yaw: -0.2 },
    ],
    pillars: [
      { position: [0, 4, 0], scale: [1.2, 8, 1.2] },
      { position: [-20, 2.5, 0], scale: [0.65, 5, 0.65] },
      { position: [20, 2.5, 0], scale: [0.65, 5, 0.65] },
    ],
    rails: [
      { position: [-16, 8.4, 0], scale: [0.12, 0.12, 8] },
      { position: [16, 8.4, 0], scale: [0.12, 0.12, 8] },
    ],
  },
  [MapId.Duna]: {
    crates: [
      { position: [-22, 0.7, -8], scale: [1.4, 1.4, 1.4], yaw: 0.17 },
      { position: [-20.5, 0.5, -7], scale: [1, 1, 1], yaw: -0.1 },
      { position: [24, 0.7, 9], scale: [1.4, 1.4, 1.4], yaw: -0.2 },
    ],
    pillars: [
      { position: [0, 2.5, -10], scale: [0.9, 5, 0.9] },
      { position: [0, 2.5, 10], scale: [0.9, 5, 0.9] },
    ],
    rails: [
      { position: [20, 3.2, -18], scale: [10, 0.12, 0.12] },
      { position: [-20, 3.2, 18], scale: [10, 0.12, 0.12] },
    ],
  },
  [MapId.Cascade]: {
    crates: [
      { position: [-18, 0.55, 0], scale: [1.1, 1.1, 1.1], yaw: 0.2 },
      { position: [18, 0.55, 0], scale: [1.1, 1.1, 1.1], yaw: -0.2 },
    ],
    pillars: [
      { position: [0, 3, -22], scale: [0.7, 6, 0.7] },
      { position: [0, 3, 22], scale: [0.7, 6, 0.7] },
    ],
    rails: [
      { position: [-20, 2.8, -20], scale: [8, 0.12, 0.12], yaw: Math.PI / 4 },
      { position: [20, 2.8, 20], scale: [8, 0.12, 0.12], yaw: Math.PI / 4 },
    ],
  },
});

const UNIT_BOX = new BoxGeometry(1, 1, 1);
const ROTATION = new Quaternion();
const POSITION = new Vector3();
const SCALE = new Vector3();
const UP = new Vector3(0, 1, 0);
const MATRIX = new Matrix4();

export class MapDressing {
  private readonly meshes: InstancedMesh[] = [];

  constructor(scene: Scene, mapId: number, material: Material) {
    const set = DRESSING[mapId] ?? DRESSING[MapId.Foundry]!;
    this.addBatch(scene, "crates", set.crates, material);
    this.addBatch(scene, "pillars", set.pillars, material);
    this.addBatch(scene, "rails", set.rails, material);
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.removeFromParent();
  }

  private addBatch(
    scene: Scene,
    name: string,
    placements: readonly DressingPlacement[],
    material: Material,
  ): void {
    const mesh = new InstancedMesh(UNIT_BOX, material, placements.length);
    mesh.name = `streamed-map-dressing-${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.collisionSource = "baked-map";
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index]!;
      POSITION.set(...placement.position);
      ROTATION.setFromAxisAngle(UP, placement.yaw ?? 0);
      SCALE.set(...placement.scale);
      MATRIX.compose(POSITION, ROTATION, SCALE);
      mesh.setMatrixAt(index, MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    this.meshes.push(mesh);
  }
}
