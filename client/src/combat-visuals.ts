import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicNodeMaterial,
  PointLight,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  type Material,
} from "three/webgpu";

import { WeaponId } from "../../packages/shared/src/index.js";

export interface ProjectileView {
  readonly key: string;
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly weaponId: number;
}

const ROCKET_GEOMETRY = new SphereGeometry(0.16, 10, 7);
const DISC_GEOMETRY = new CylinderGeometry(0.2, 0.2, 0.055, 18);
const IDENTITY = new Quaternion();
const HIDDEN = new Matrix4().compose(
  new Vector3(0, -10_000, 0),
  IDENTITY,
  new Vector3(0, 0, 0),
);

export class ProjectileVisualSystem {
  readonly rocketCores: InstancedMesh;
  readonly discCores: InstancedMesh;
  readonly trails: LineSegments;
  readonly smokePuffs: InstancedMesh;
  private readonly trailGeometry: BufferGeometry;
  private readonly trailPositions: Float32Array;
  private readonly prior = new Map<string, Vector3>();
  private readonly lights: PointLight[] = [];
  private readonly capacity: number;

  constructor(scene: Scene, material: Material, capacity = 48) {
    this.capacity = capacity;
    this.rocketCores = new InstancedMesh(ROCKET_GEOMETRY, material, capacity);
    this.rocketCores.name = "projectile-meshes-rockets";
    this.rocketCores.userData.projectileMeshes = true;
    this.discCores = new InstancedMesh(DISC_GEOMETRY, material, capacity);
    this.discCores.name = "projectile-meshes-discs";
    this.discCores.userData.projectileMeshes = true;
    this.trailPositions = new Float32Array(capacity * 2 * 3);
    this.trailGeometry = new BufferGeometry();
    this.trailGeometry.setAttribute("position", new BufferAttribute(this.trailPositions, 3));
    this.trails = new LineSegments(
      this.trailGeometry,
      new LineBasicMaterial({
        color: 0x8eeaff,
        transparent: true,
        opacity: 0.72,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.trails.name = "projectile-additive-trails";
    this.trails.userData.discRibbon = true;
    this.smokePuffs = new InstancedMesh(
      new SphereGeometry(0.13, 6, 4),
      new MeshBasicNodeMaterial({
        color: new Color(0xb9c0c6),
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
      capacity,
    );
    this.smokePuffs.name = "rocket-smoke-puffs";
    this.smokePuffs.userData.rocketSmoke = true;
    scene.add(this.rocketCores, this.discCores, this.trails, this.smokePuffs);
    for (let index = 0; index < 4; index += 1) {
      const light = new PointLight(0xffb45d, 2.2, 5.5, 2);
      light.visible = false;
      this.lights.push(light);
      scene.add(light);
    }
  }

  setMaterial(material: Material): void {
    this.rocketCores.material = material;
    this.discCores.material = material;
  }

  update(views: readonly ProjectileView[]): void {
    let rockets = 0;
    let discs = 0;
    let trails = 0;
    let lights = 0;
    const visible = new Set<string>();
    for (const view of views.slice(0, this.capacity)) {
      visible.add(view.key);
      const position = new Vector3(view.position.x, view.position.y, view.position.z);
      const matrix = new Matrix4().makeTranslation(position.x, position.y, position.z);
      if (view.weaponId === WeaponId.Peacemaker) {
        this.rocketCores.setMatrixAt(rockets++, matrix);
        const previous = this.prior.get(view.key) ?? position;
        const smokePosition = position.clone().lerp(previous, 0.6);
        this.smokePuffs.setMatrixAt(
          rockets - 1,
          new Matrix4().compose(
            smokePosition,
            IDENTITY,
            new Vector3(1 + rockets * 0.025, 1 + rockets * 0.025, 1 + rockets * 0.025),
          ),
        );
        if (lights < this.lights.length) {
          const light = this.lights[lights++]!;
          light.visible = true;
          light.position.copy(position);
        }
      } else {
        matrix.multiply(new Matrix4().makeRotationX(Math.PI / 2));
        this.discCores.setMatrixAt(discs++, matrix);
      }
      const previous = this.prior.get(view.key) ?? position;
      const offset = trails * 6;
      this.trailPositions.set([
        previous.x, previous.y, previous.z,
        position.x, position.y, position.z,
      ], offset);
      trails += 1;
      this.prior.set(view.key, position);
    }
    for (let index = rockets; index < this.capacity; index += 1) {
      this.rocketCores.setMatrixAt(index, HIDDEN);
      this.smokePuffs.setMatrixAt(index, HIDDEN);
    }
    for (let index = discs; index < this.capacity; index += 1) {
      this.discCores.setMatrixAt(index, HIDDEN);
    }
    for (const [key] of this.prior) if (!visible.has(key)) this.prior.delete(key);
    for (let index = lights; index < this.lights.length; index += 1) {
      this.lights[index]!.visible = false;
    }
    this.rocketCores.count = Math.max(1, rockets);
    this.discCores.count = Math.max(1, discs);
    this.rocketCores.instanceMatrix.needsUpdate = true;
    this.smokePuffs.count = Math.max(1, rockets);
    this.smokePuffs.instanceMatrix.needsUpdate = true;
    this.discCores.instanceMatrix.needsUpdate = true;
    this.trailGeometry.setDrawRange(0, trails * 2);
    this.trailGeometry.attributes.position!.needsUpdate = true;
    this.trails.visible = trails !== 0;
  }
}

export interface RemoteCharacterState {
  readonly id: number;
  readonly generation?: number;
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly velocity: Readonly<{ x: number; y: number; z: number }>;
  readonly grounded: boolean;
  readonly alive: boolean;
  readonly ducked?: boolean;
}

const PARTS = ["torso", "head", "leftArm", "rightArm", "leftLeg", "rightLeg"] as const;
type PartName = typeof PARTS[number];
const PART_GEOMETRY: Readonly<Record<PartName, BoxGeometry | SphereGeometry>> = {
  torso: new BoxGeometry(0.56, 0.78, 0.3),
  head: new SphereGeometry(0.22, 10, 7),
  leftArm: new BoxGeometry(0.16, 0.66, 0.16),
  rightArm: new BoxGeometry(0.16, 0.66, 0.16),
  leftLeg: new BoxGeometry(0.2, 0.72, 0.22),
  rightLeg: new BoxGeometry(0.2, 0.72, 0.22),
};

function localPartMatrix(
  offset: readonly [number, number, number],
  rotation: Euler,
  scaleY: number,
): Matrix4 {
  return new Matrix4().compose(
    new Vector3(offset[0], offset[1] * scaleY, offset[2]),
    new Quaternion().setFromEuler(rotation),
    new Vector3(1, scaleY, 1),
  );
}

export class RemoteCharacterSystem {
  readonly meshes: Readonly<Record<PartName, InstancedMesh>>;
  readonly rimTorso: InstancedMesh;
  readonly rimHead: InstancedMesh;
  private readonly capacity: number;
  private readonly spawnKeys = new Map<number, string>();
  private readonly spawnedAt = new Map<number, number>();

  constructor(scene: Scene, material: Material, capacity = 12) {
    this.capacity = capacity;
    this.meshes = Object.fromEntries(PARTS.map((part) => {
      const mesh = new InstancedMesh(PART_GEOMETRY[part], material, capacity);
      mesh.name = `remote-character-${part}`;
      mesh.userData.riggedHumanoid = true;
      scene.add(mesh);
      return [part, mesh];
    })) as unknown as Readonly<Record<PartName, InstancedMesh>>;
    const rimMaterial = new MeshBasicNodeMaterial({
      color: new Color(0x65d4ff),
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.rimTorso = new InstancedMesh(PART_GEOMETRY.torso, rimMaterial, capacity);
    this.rimHead = new InstancedMesh(PART_GEOMETRY.head, rimMaterial, capacity);
    this.rimTorso.name = "enemy-accent-rim-torso";
    this.rimHead.name = "enemy-accent-rim-head";
    scene.add(this.rimTorso, this.rimHead);
  }

  setMaterial(material: Material): void {
    for (const mesh of Object.values(this.meshes)) mesh.material = material;
  }

  update(states: readonly RemoteCharacterState[], elapsedSeconds: number): void {
    const visible = states.slice(0, this.capacity);
    const ids = new Set(visible.map((state) => state.id));
    for (let index = 0; index < this.capacity; index += 1) {
      const state = visible[index];
      if (state === undefined) {
        for (const mesh of Object.values(this.meshes)) mesh.setMatrixAt(index, HIDDEN);
        this.rimTorso.setMatrixAt(index, HIDDEN);
        this.rimHead.setMatrixAt(index, HIDDEN);
        continue;
      }
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      const spawnKey = `${state.generation ?? 0}:${state.alive ? 1 : 0}`;
      if (state.alive && this.spawnKeys.get(state.id) !== spawnKey) {
        this.spawnedAt.set(state.id, elapsedSeconds);
      }
      this.spawnKeys.set(state.id, spawnKey);
      const spawnAge = elapsedSeconds - (this.spawnedAt.get(state.id) ?? -10);
      const shimmer = state.alive && spawnAge < 1.5
        ? 1 + Math.sin(spawnAge * Math.PI * 12) * 0.035
        : 1;
      const facing = speed > 0.15
        ? Math.atan2(state.velocity.x, state.velocity.z)
        : 0;
      const duckScale = state.ducked === true ? 0.56 : 1;
      const phase = elapsedSeconds * Math.min(12, 4 + speed * 1.3) + state.id;
      const stride = state.grounded ? Math.sin(phase) * Math.min(0.72, speed * 0.09) : 0.34;
      const airborneTuck = state.grounded ? 0 : 0.48;
      const deathRoll = state.alive ? 0 : Math.PI / 2;
      const root = new Matrix4().compose(
        new Vector3(
          state.position.x,
          state.position.y + (state.alive ? 0 : 0.28),
          state.position.z,
        ),
        new Quaternion().setFromEuler(new Euler(0, facing, deathRoll)),
        new Vector3(shimmer, 1, shimmer),
      );
      const matrices: Record<PartName, Matrix4> = {
        torso: localPartMatrix([0, 1.08, 0], new Euler(0, 0, -state.velocity.x * 0.015), duckScale),
        head: localPartMatrix([0, 1.62, 0], new Euler(0, 0, 0), duckScale),
        leftArm: localPartMatrix([-0.38, 1.08, 0], new Euler(stride, 0, 0), duckScale),
        rightArm: localPartMatrix([0.38, 1.08, 0], new Euler(-stride, 0, 0), duckScale),
        leftLeg: localPartMatrix([-0.16, 0.42 + airborneTuck * 0.2, 0], new Euler(-stride + airborneTuck, 0, 0), duckScale),
        rightLeg: localPartMatrix([0.16, 0.42 + airborneTuck * 0.2, 0], new Euler(stride + airborneTuck, 0, 0), duckScale),
      };
      for (const part of PARTS) {
        this.meshes[part].setMatrixAt(index, root.clone().multiply(matrices[part]));
      }
      this.rimTorso.setMatrixAt(
        index,
        root.clone().multiply(matrices.torso).scale(new Vector3(1.08, 1.08, 1.08)),
      );
      this.rimHead.setMatrixAt(
        index,
        root.clone().multiply(matrices.head).scale(new Vector3(1.12, 1.12, 1.12)),
      );
    }
    for (const mesh of [...Object.values(this.meshes), this.rimTorso, this.rimHead]) {
      mesh.count = Math.max(1, visible.length);
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const id of this.spawnKeys.keys()) {
      if (!ids.has(id)) {
        this.spawnKeys.delete(id);
        this.spawnedAt.delete(id);
      }
    }
  }
}
