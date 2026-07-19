import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PointLight,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from "three/webgpu";

const SPARK_CAPACITY = 64;
const PUFF_CAPACITY = 24;
export const CASING_CAPACITY = 32;
const HIDDEN_MATRIX = new Matrix4().makeScale(0, 0, 0);

export class ImpactVisualSystem {
  readonly sparks: InstancedMesh;
  readonly puffs: InstancedMesh;
  readonly casings: InstancedMesh;
  private readonly lights: PointLight[] = [];
  private readonly sparkLife = new Float32Array(SPARK_CAPACITY);
  private readonly sparkPosition = new Float32Array(SPARK_CAPACITY * 3);
  private readonly sparkVelocity = new Float32Array(SPARK_CAPACITY * 3);
  private readonly puffLife = new Float32Array(PUFF_CAPACITY);
  private readonly puffPosition = new Float32Array(PUFF_CAPACITY * 3);
  private readonly casingLife = new Float32Array(CASING_CAPACITY);
  private readonly casingPosition = new Float32Array(CASING_CAPACITY * 3);
  private readonly casingVelocity = new Float32Array(CASING_CAPACITY * 3);
  private sparkCursor = 0;
  private puffCursor = 0;
  private casingCursor = 0;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly spinAxis = new Vector3(1, 1, 0).normalize();
  private readonly rotation = new Quaternion();

  constructor(scene: Scene) {
    this.sparks = new InstancedMesh(
      new BoxGeometry(0.018, 0.018, 0.16),
      new MeshBasicNodeMaterial({
        color: 0xffd07a,
        blending: AdditiveBlending,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
      SPARK_CAPACITY,
    );
    this.puffs = new InstancedMesh(
      new SphereGeometry(0.13, 6, 4),
      new MeshBasicNodeMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
      PUFF_CAPACITY,
    );
    this.casings = new InstancedMesh(
      new BoxGeometry(0.025, 0.065, 0.025),
      new MeshStandardNodeMaterial({
        color: 0xc89745,
        roughness: 0.38,
        metalness: 0.82,
      }),
      CASING_CAPACITY,
    );
    this.sparks.name = "impact-sparks-instanced";
    this.puffs.name = "impact-puffs-instanced";
    this.casings.name = "shell-casings-pooled-32";
    this.resetMatrices(this.sparks, SPARK_CAPACITY);
    this.resetMatrices(this.puffs, PUFF_CAPACITY);
    this.resetMatrices(this.casings, CASING_CAPACITY);
    scene.add(this.sparks, this.puffs, this.casings);
    for (let index = 0; index < 4; index += 1) {
      const light = new PointLight(0xffb35f, 0, 4.5, 2);
      light.userData.frames = 0;
      this.lights.push(light);
      scene.add(light);
    }
  }

  impact(
    point: Readonly<{ x: number; y: number; z: number }>,
    surfaceColor: number,
    rocket = false,
  ): void {
    for (let count = 0; count < 4; count += 1) {
      const index = this.sparkCursor++ % SPARK_CAPACITY;
      const base = index * 3;
      const phase = (index * 2.399963 + count * 1.31) % (Math.PI * 2);
      const speed = 2.8 + count * 0.55;
      this.sparkLife[index] = 0.13;
      this.sparkPosition[base] = point.x;
      this.sparkPosition[base + 1] = point.y;
      this.sparkPosition[base + 2] = point.z;
      this.sparkVelocity[base] = Math.cos(phase) * speed;
      this.sparkVelocity[base + 1] = 1.4 + count * 0.45;
      this.sparkVelocity[base + 2] = Math.sin(phase) * speed;
    }
    const puff = this.puffCursor++ % PUFF_CAPACITY;
    const puffBase = puff * 3;
    this.puffLife[puff] = rocket ? 0.26 : 0.18;
    this.puffPosition[puffBase] = point.x;
    this.puffPosition[puffBase + 1] = point.y;
    this.puffPosition[puffBase + 2] = point.z;
    this.puffs.setColorAt(puff, new Color(rocket ? 0x2a211b : surfaceColor));
    const light = this.lights[this.puffCursor % this.lights.length]!;
    light.color.set(rocket ? 0xff7538 : 0xffc27a);
    light.intensity = rocket ? 7 : 4;
    light.position.set(point.x, point.y, point.z);
    light.userData.frames = 1;
  }

  ejectCasing(
    origin: Readonly<{ x: number; y: number; z: number }>,
    yaw: number,
  ): void {
    const index = this.casingCursor++ % CASING_CAPACITY;
    const base = index * 3;
    this.casingLife[index] = 0.72;
    this.casingPosition[base] = origin.x;
    this.casingPosition[base + 1] = origin.y - 0.18;
    this.casingPosition[base + 2] = origin.z;
    this.casingVelocity[base] = Math.cos(yaw) * 1.7;
    this.casingVelocity[base + 1] = 1.65;
    this.casingVelocity[base + 2] = -Math.sin(yaw) * 1.7;
  }

  update(dtSeconds: number): void {
    for (let index = 0; index < SPARK_CAPACITY; index += 1) {
      const life = Math.max(0, this.sparkLife[index]! - dtSeconds);
      this.sparkLife[index] = life;
      if (life === 0) {
        this.sparks.setMatrixAt(index, HIDDEN_MATRIX);
        continue;
      }
      const base = index * 3;
      this.sparkVelocity[base + 1] = this.sparkVelocity[base + 1]! - 12 * dtSeconds;
      for (let axis = 0; axis < 3; axis += 1) {
        this.sparkPosition[base + axis] =
          this.sparkPosition[base + axis]! + this.sparkVelocity[base + axis]! * dtSeconds;
      }
      this.position.fromArray(this.sparkPosition, base);
      this.scale.set(1, 1, Math.max(0.2, life / 0.13));
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.sparks.setMatrixAt(index, this.matrix);
    }
    for (let index = 0; index < PUFF_CAPACITY; index += 1) {
      const life = Math.max(0, this.puffLife[index]! - dtSeconds);
      this.puffLife[index] = life;
      if (life === 0) {
        this.puffs.setMatrixAt(index, HIDDEN_MATRIX);
        continue;
      }
      const base = index * 3;
      this.puffPosition[base + 1] = this.puffPosition[base + 1]! + dtSeconds * 0.24;
      this.position.fromArray(this.puffPosition, base);
      const age = 1 - life / 0.26;
      this.scale.setScalar(0.75 + age * 1.8);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.puffs.setMatrixAt(index, this.matrix);
    }
    for (let index = 0; index < CASING_CAPACITY; index += 1) {
      const life = Math.max(0, this.casingLife[index]! - dtSeconds);
      this.casingLife[index] = life;
      if (life === 0) {
        this.casings.setMatrixAt(index, HIDDEN_MATRIX);
        continue;
      }
      const base = index * 3;
      this.casingVelocity[base + 1] = this.casingVelocity[base + 1]! - 8.5 * dtSeconds;
      for (let axis = 0; axis < 3; axis += 1) {
        this.casingPosition[base + axis] =
          this.casingPosition[base + axis]! + this.casingVelocity[base + axis]! * dtSeconds;
      }
      this.position.fromArray(this.casingPosition, base);
      this.rotation.setFromAxisAngle(this.spinAxis, life * 24);
      this.scale.set(1, 1, 1);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.casings.setMatrixAt(index, this.matrix);
    }
    for (const light of this.lights) {
      const frames = Number(light.userData.frames ?? 0);
      light.userData.frames = Math.max(0, frames - 1);
      if (frames <= 0) light.intensity = 0;
    }
    this.sparks.instanceMatrix.needsUpdate = true;
    this.puffs.instanceMatrix.needsUpdate = true;
    if (this.puffs.instanceColor !== null) this.puffs.instanceColor.needsUpdate = true;
    this.casings.instanceMatrix.needsUpdate = true;
  }

  private resetMatrices(mesh: InstancedMesh, capacity: number): void {
    for (let index = 0; index < capacity; index += 1) mesh.setMatrixAt(index, HIDDEN_MATRIX);
    mesh.instanceMatrix.needsUpdate = true;
  }
}
