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
  private readonly position = new Vector3();
  private readonly smokePosition = new Vector3();
  private readonly scale = new Vector3();
  private readonly matrix = new Matrix4();
  private readonly matrixScratch = new Matrix4();

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
    const visibleCount = Math.min(views.length, this.capacity);
    for (let viewIndex = 0; viewIndex < visibleCount; viewIndex += 1) {
      const view = views[viewIndex]!;
      this.position.set(view.position.x, view.position.y, view.position.z);
      this.matrix.makeTranslation(this.position.x, this.position.y, this.position.z);
      if (view.weaponId === WeaponId.Peacemaker) {
        this.rocketCores.setMatrixAt(rockets++, this.matrix);
        const previous = this.prior.get(view.key);
        this.smokePosition.copy(this.position);
        if (previous !== undefined) this.smokePosition.lerp(previous, 0.6);
        this.scale.setScalar(1 + rockets * 0.025);
        this.smokePuffs.setMatrixAt(
          rockets - 1,
          this.matrix.compose(this.smokePosition, IDENTITY, this.scale),
        );
        if (lights < this.lights.length) {
          const light = this.lights[lights++]!;
          light.visible = true;
          light.position.copy(this.position);
        }
      } else {
        this.rotationMatrixX(this.matrix);
        this.discCores.setMatrixAt(discs++, this.matrix);
      }
      const previous = this.prior.get(view.key);
      const offset = trails * 6;
      this.trailPositions[offset] = previous?.x ?? this.position.x;
      this.trailPositions[offset + 1] = previous?.y ?? this.position.y;
      this.trailPositions[offset + 2] = previous?.z ?? this.position.z;
      this.trailPositions[offset + 3] = this.position.x;
      this.trailPositions[offset + 4] = this.position.y;
      this.trailPositions[offset + 5] = this.position.z;
      trails += 1;
      if (previous === undefined) this.prior.set(view.key, new Vector3().copy(this.position));
      else previous.copy(this.position);
    }
    for (let index = rockets; index < this.capacity; index += 1) {
      this.rocketCores.setMatrixAt(index, HIDDEN);
      this.smokePuffs.setMatrixAt(index, HIDDEN);
    }
    for (let index = discs; index < this.capacity; index += 1) {
      this.discCores.setMatrixAt(index, HIDDEN);
    }
    for (const [key] of this.prior) {
      let visible = false;
      for (let index = 0; index < visibleCount; index += 1) {
        if (views[index]?.key === key) {
          visible = true;
          break;
        }
      }
      if (!visible) this.prior.delete(key);
    }
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

  private rotationMatrixX(matrix: Matrix4): void {
    const c = 0;
    const s = 1;
    matrix.multiply(this.scaleMatrixElements(c, s));
  }

  private scaleMatrixElements(c: number, s: number): Matrix4 {
    return this.matrixScratch.set(
      1, 0, 0, 0,
      0, c, -s, 0,
      0, s, c, 0,
      0, 0, 0, 1,
    );
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

export class RemoteCharacterSystem {
  readonly meshes: Readonly<Record<PartName, InstancedMesh>>;
  readonly rimTorso: InstancedMesh;
  readonly rimHead: InstancedMesh;
  readonly footstepDust: InstancedMesh;
  private readonly capacity: number;
  private readonly generations = new Map<number, number>();
  private readonly alive = new Map<number, boolean>();
  private readonly spawnedAt = new Map<number, number>();
  private readonly diedAt = new Map<number, number>();
  private readonly visibleIds = new Set<number>();
  private readonly rootMatrix = new Matrix4();
  private readonly localMatrix = new Matrix4();
  private readonly resultMatrix = new Matrix4();
  private readonly rootPosition = new Vector3();
  private readonly localPosition = new Vector3();
  private readonly scale = new Vector3();
  private readonly rootEuler = new Euler();
  private readonly localEuler = new Euler();
  private readonly quaternion = new Quaternion();
  private readonly dustLife = new Float32Array(32);
  private readonly dustPosition = new Float32Array(32 * 3);
  private readonly lastStep = new Map<number, number>();
  private dustCursor = 0;
  private lastElapsedSeconds = 0;

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
    this.footstepDust = new InstancedMesh(
      new SphereGeometry(0.09, 5, 3),
      new MeshBasicNodeMaterial({
        color: 0xb8aa92,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      }),
      32,
    );
    this.footstepDust.name = "character-footstep-dust";
    scene.add(this.rimTorso, this.rimHead, this.footstepDust);
    for (let index = 0; index < 32; index += 1) {
      this.footstepDust.setMatrixAt(index, HIDDEN);
    }
  }

  setMaterial(material: Material): void {
    for (const mesh of Object.values(this.meshes)) mesh.material = material;
  }

  update(states: readonly RemoteCharacterState[], elapsedSeconds: number): void {
    const visibleCount = Math.min(states.length, this.capacity);
    this.visibleIds.clear();
    for (let index = 0; index < this.capacity; index += 1) {
      const state = index < visibleCount ? states[index] : undefined;
      if (state === undefined) {
        for (const part of PARTS) this.meshes[part].setMatrixAt(index, HIDDEN);
        this.rimTorso.setMatrixAt(index, HIDDEN);
        this.rimHead.setMatrixAt(index, HIDDEN);
        continue;
      }
      this.visibleIds.add(state.id);
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      const generation = state.generation ?? 0;
      const wasAlive = this.alive.get(state.id);
      if (state.alive && (this.generations.get(state.id) !== generation || wasAlive !== true)) {
        this.spawnedAt.set(state.id, elapsedSeconds);
        this.diedAt.delete(state.id);
      } else if (!state.alive && wasAlive !== false) {
        this.diedAt.set(state.id, elapsedSeconds);
      }
      this.generations.set(state.id, generation);
      this.alive.set(state.id, state.alive);
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
      const fade = state.alive
        ? 1
        : Math.max(0, 1 - (elapsedSeconds - (this.diedAt.get(state.id) ?? elapsedSeconds)) / 0.85);
      this.rootPosition.set(
        state.position.x,
        state.position.y + (state.alive ? 0 : 0.28),
        state.position.z,
      );
      this.rootEuler.set(0, facing, deathRoll);
      this.scale.set(shimmer * fade, fade, shimmer * fade);
      this.rootMatrix.compose(
        this.rootPosition,
        this.quaternion.setFromEuler(this.rootEuler),
        this.scale,
      );
      this.writePart(index, "torso", 0, 1.08, 0, 0, -state.velocity.x * 0.015, duckScale);
      this.writePart(index, "head", 0, 1.62, 0, 0, 0, duckScale);
      this.writePart(index, "leftArm", -0.38, 1.08, 0, stride, 0, duckScale);
      this.writePart(index, "rightArm", 0.38, 1.08, 0, -stride, 0, duckScale);
      this.writePart(index, "leftLeg", -0.16, 0.42 + airborneTuck * 0.2, 0,
        -stride + airborneTuck, 0, duckScale);
      this.writePart(index, "rightLeg", 0.16, 0.42 + airborneTuck * 0.2, 0,
        stride + airborneTuck, 0, duckScale);
      this.writeRim(index, "torso", 1.08);
      this.writeRim(index, "head", 1.12);

      const step = Math.floor(phase / Math.PI);
      if (state.alive && state.grounded && speed > 2.2 && this.lastStep.get(state.id) !== step) {
        this.lastStep.set(state.id, step);
        this.spawnDust(state.position);
      }
    }
    for (const part of PARTS) {
      const mesh = this.meshes[part];
      mesh.count = Math.max(1, visibleCount);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.rimTorso.count = Math.max(1, visibleCount);
    this.rimHead.count = Math.max(1, visibleCount);
    this.rimTorso.instanceMatrix.needsUpdate = true;
    this.rimHead.instanceMatrix.needsUpdate = true;
    this.updateDust(Math.max(0, elapsedSeconds - this.lastElapsedSeconds));
    this.lastElapsedSeconds = elapsedSeconds;
    for (const id of this.generations.keys()) {
      if (!this.visibleIds.has(id)) {
        this.generations.delete(id);
        this.alive.delete(id);
        this.spawnedAt.delete(id);
        this.diedAt.delete(id);
        this.lastStep.delete(id);
      }
    }
  }

  private writePart(
    index: number,
    part: PartName,
    x: number,
    y: number,
    z: number,
    rotationX: number,
    rotationZ: number,
    scaleY: number,
  ): void {
    this.localPosition.set(x, y * scaleY, z);
    this.localEuler.set(rotationX, 0, rotationZ);
    this.scale.set(1, scaleY, 1);
    this.localMatrix.compose(
      this.localPosition,
      this.quaternion.setFromEuler(this.localEuler),
      this.scale,
    );
    this.resultMatrix.multiplyMatrices(this.rootMatrix, this.localMatrix);
    this.meshes[part].setMatrixAt(index, this.resultMatrix);
  }

  private writeRim(index: number, part: "torso" | "head", scale: number): void {
    const mesh = this.meshes[part];
    mesh.getMatrixAt(index, this.resultMatrix);
    this.scale.setScalar(scale);
    this.resultMatrix.scale(this.scale);
    (part === "torso" ? this.rimTorso : this.rimHead).setMatrixAt(index, this.resultMatrix);
  }

  private spawnDust(position: Readonly<{ x: number; y: number; z: number }>): void {
    const index = this.dustCursor++ % this.dustLife.length;
    const base = index * 3;
    this.dustLife[index] = 0.34;
    this.dustPosition[base] = position.x;
    this.dustPosition[base + 1] = position.y + 0.06;
    this.dustPosition[base + 2] = position.z;
  }

  private updateDust(dt: number): void {
    for (let index = 0; index < this.dustLife.length; index += 1) {
      const life = Math.max(0, this.dustLife[index]! - dt);
      this.dustLife[index] = life;
      if (life === 0) {
        this.footstepDust.setMatrixAt(index, HIDDEN);
        continue;
      }
      const base = index * 3;
      this.dustPosition[base + 1] = this.dustPosition[base + 1]! + dt * 0.14;
      this.rootPosition.fromArray(this.dustPosition, base);
      this.scale.setScalar(0.7 + (1 - life / 0.34) * 1.8);
      this.resultMatrix.compose(this.rootPosition, IDENTITY, this.scale);
      this.footstepDust.setMatrixAt(index, this.resultMatrix);
    }
    this.footstepDust.instanceMatrix.needsUpdate = true;
  }
}
