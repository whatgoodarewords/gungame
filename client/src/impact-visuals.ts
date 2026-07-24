import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from "three/webgpu";
import { BULLET_DECAL_URL } from "./asset-manifest.js";

const SPARK_CAPACITY = 64;
const PUFF_CAPACITY = 24;
const BURST_CAPACITY = 96;
export const CASING_CAPACITY = 32;
const DECAL_CAPACITY = 160;
const CASING_LIFE_S = 3.0;
const HIDDEN_MATRIX = new Matrix4().makeScale(0, 0, 0);
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_X = new Vector3(1, 0, 0);
const PLANE_FORWARD = new Vector3(0, 0, 1);

export class ImpactVisualSystem {
  readonly sparks: InstancedMesh;
  readonly puffs: InstancedMesh;
  readonly bursts: InstancedMesh;
  readonly casings: InstancedMesh;
  private readonly lights: PointLight[] = [];
  private readonly sparkLife = new Float32Array(SPARK_CAPACITY);
  private readonly sparkPosition = new Float32Array(SPARK_CAPACITY * 3);
  private readonly sparkVelocity = new Float32Array(SPARK_CAPACITY * 3);
  private readonly puffLife = new Float32Array(PUFF_CAPACITY);
  private readonly puffPosition = new Float32Array(PUFF_CAPACITY * 3);
  private readonly burstLife = new Float32Array(BURST_CAPACITY);
  private readonly burstMaxLife = new Float32Array(BURST_CAPACITY);
  private readonly burstPosition = new Float32Array(BURST_CAPACITY * 3);
  private readonly burstVelocity = new Float32Array(BURST_CAPACITY * 3);
  private burstCursor = 0;
  private readonly casingLife = new Float32Array(CASING_CAPACITY);
  private readonly casingPosition = new Float32Array(CASING_CAPACITY * 3);
  private readonly casingVelocity = new Float32Array(CASING_CAPACITY * 3);
  private readonly casingFloor = new Float32Array(CASING_CAPACITY);
  private readonly casingBounces = new Uint8Array(CASING_CAPACITY);
  private readonly casingResting = new Uint8Array(CASING_CAPACITY);
  readonly decals: InstancedMesh;
  private decalCursor = 0;
  /** First floor contact per casing — main wires this to the brass tinkle. */
  onCasingBounce: ((x: number, y: number, z: number) => void) | undefined;
  private sparkCursor = 0;
  private puffCursor = 0;
  private casingCursor = 0;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly spinAxis = new Vector3(1, 1, 0).normalize();
  private readonly rotation = new Quaternion();
  private readonly rollQuaternion = new Quaternion();
  private readonly normalVector = new Vector3();
  private readonly tangentA = new Vector3();
  private readonly tangentB = new Vector3();

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
    this.bursts = new InstancedMesh(
      new BoxGeometry(0.032, 0.032, 0.032),
      new MeshBasicNodeMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
      BURST_CAPACITY,
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
    // Bullet-hole decal pool: persistent (pool-wraps at capacity, no per-frame
    // cost — matrices are written once at spawn). polygonOffset beats z-fight
    // against the wall it sits on.
    const decalMaterial = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    new TextureLoader().load(BULLET_DECAL_URL, (texture) => {
      texture.colorSpace = SRGBColorSpace;
      decalMaterial.map = texture;
      decalMaterial.needsUpdate = true;
      this.decals.visible = true;
    });
    this.decals = new InstancedMesh(
      new PlaneGeometry(0.11, 0.11),
      decalMaterial,
      DECAL_CAPACITY,
    );
    // Hidden until the texture lands: an untextured white quad pool would
    // flash solid squares on the first shots of a session.
    this.decals.visible = false;
    // Instances spread across the whole map; the base plane's bounds would
    // cull them all as soon as the origin leaves the frustum.
    this.decals.frustumCulled = false;
    this.sparks.name = "impact-sparks-instanced";
    this.puffs.name = "impact-puffs-instanced";
    this.bursts.name = "hit-burst-embers-instanced";
    this.casings.name = "shell-casings-pooled-32";
    this.decals.name = "bullet-hole-decals-pooled-160";
    this.resetMatrices(this.sparks, SPARK_CAPACITY);
    this.resetMatrices(this.puffs, PUFF_CAPACITY);
    this.resetMatrices(this.bursts, BURST_CAPACITY);
    this.resetMatrices(this.casings, CASING_CAPACITY);
    this.resetMatrices(this.decals, DECAL_CAPACITY);
    scene.add(this.sparks, this.puffs, this.bursts, this.casings, this.decals);
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
    normal?: Readonly<{ x: number; y: number; z: number }>,
  ): void {
    // Debris cone leaves ALONG the surface normal (combat-fx-reference: the
    // pre-normal system sprayed everything upward, so wall hits read as
    // floor hits). No normal (player hits, legacy calls) keeps the up-cone.
    this.normalVector.set(normal?.x ?? 0, normal?.y ?? 1, normal?.z ?? 0).normalize();
    this.tangentA.crossVectors(
      this.normalVector,
      Math.abs(this.normalVector.y) > 0.92 ? WORLD_X : WORLD_UP,
    ).normalize();
    this.tangentB.crossVectors(this.normalVector, this.tangentA);
    for (let count = 0; count < 4; count += 1) {
      const index = this.sparkCursor++ % SPARK_CAPACITY;
      const base = index * 3;
      const phase = (index * 2.399963 + count * 1.31) % (Math.PI * 2);
      const ring = 1.5 + count * 0.35;
      const along = 2.2 + count * 0.5;
      this.sparkLife[index] = 0.13;
      this.sparkPosition[base] = point.x;
      this.sparkPosition[base + 1] = point.y;
      this.sparkPosition[base + 2] = point.z;
      this.sparkVelocity[base] = this.normalVector.x * along +
        (this.tangentA.x * Math.cos(phase) + this.tangentB.x * Math.sin(phase)) * ring;
      this.sparkVelocity[base + 1] = this.normalVector.y * along + 0.6 +
        (this.tangentA.y * Math.cos(phase) + this.tangentB.y * Math.sin(phase)) * ring;
      this.sparkVelocity[base + 2] = this.normalVector.z * along +
        (this.tangentA.z * Math.cos(phase) + this.tangentB.z * Math.sin(phase)) * ring;
    }
    const puff = this.puffCursor++ % PUFF_CAPACITY;
    const puffBase = puff * 3;
    this.puffLife[puff] = rocket ? 0.26 : 0.18;
    this.puffPosition[puffBase] = point.x + this.normalVector.x * 0.06;
    this.puffPosition[puffBase + 1] = point.y + this.normalVector.y * 0.06;
    this.puffPosition[puffBase + 2] = point.z + this.normalVector.z * 0.06;
    this.puffs.setColorAt(puff, new Color(rocket ? 0x2a211b : surfaceColor));
    const light = this.lights[this.puffCursor % this.lights.length]!;
    light.color.set(rocket ? 0xff7538 : 0xffc27a);
    light.intensity = rocket ? 7 : 4;
    light.position.set(point.x, point.y, point.z);
    light.userData.frames = 1;
  }

  /**
   * Ember-confetti hit language (combat-juice J6 — bright register, no gore):
   * 8 particles on a hit, 22 on the kill pop, colored to the victim so the
   * feedback reads on the daylight world. Deterministic golden-angle spread.
   */
  hitBurst(
    point: Readonly<{ x: number; y: number; z: number }>,
    color: number,
    kill = false,
  ): void {
    const count = kill ? 22 : 8;
    const life = kill ? 0.55 : 0.4;
    const tint = new Color(color);
    for (let n = 0; n < count; n += 1) {
      const index = this.burstCursor++ % BURST_CAPACITY;
      const base = index * 3;
      const phase = (index * 2.399963 + n * 0.71) % (Math.PI * 2);
      const lift = ((n * 37) % 100) / 100;
      const speed = (kill ? 3.6 : 2.4) + ((n * 53) % 100) / 100 * 1.6;
      this.burstLife[index] = life * (0.7 + lift * 0.3);
      this.burstMaxLife[index] = this.burstLife[index]!;
      this.burstPosition[base] = point.x;
      this.burstPosition[base + 1] = point.y + 1.0;
      this.burstPosition[base + 2] = point.z;
      this.burstVelocity[base] = Math.cos(phase) * speed;
      this.burstVelocity[base + 1] = 1.8 + lift * (kill ? 3.4 : 2.2);
      this.burstVelocity[base + 2] = Math.sin(phase) * speed;
      this.bursts.setColorAt(index, tint);
    }
  }

  /** One-frame warm glow at a remote shooter's muzzle (pooled lights). */
  muzzleGlow(position: Readonly<{ x: number; y: number; z: number }>): void {
    const light = this.lights[this.puffCursor % this.lights.length]!;
    light.color.set(0xffc27a);
    light.intensity = 2.6;
    light.position.set(position.x, position.y, position.z);
    light.userData.frames = 1;
  }

  /**
   * Bullet-hole decal at a wall hit: oriented to the surface, deterministic
   * golden-angle roll + size wobble so a spray never tiles. Matrices write
   * once — the pool costs nothing per frame and wraps at capacity, CS-style.
   */
  addDecal(
    point: Readonly<{ x: number; y: number; z: number }>,
    normal: Readonly<{ x: number; y: number; z: number }>,
  ): void {
    const index = this.decalCursor++ % DECAL_CAPACITY;
    this.normalVector.set(normal.x, normal.y, normal.z).normalize();
    this.position.set(
      point.x + this.normalVector.x * 0.006,
      point.y + this.normalVector.y * 0.006,
      point.z + this.normalVector.z * 0.006,
    );
    this.rotation.setFromUnitVectors(PLANE_FORWARD, this.normalVector);
    this.rollQuaternion.setFromAxisAngle(PLANE_FORWARD, index * 2.399963);
    this.rotation.multiply(this.rollQuaternion);
    const size = 0.85 + ((index * 37) % 100) / 100 * 0.45;
    this.scale.set(size, size, 1);
    this.matrix.compose(this.position, this.rotation, this.scale);
    this.decals.setMatrixAt(index, this.matrix);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  ejectCasing(
    origin: Readonly<{ x: number; y: number; z: number }>,
    yaw: number,
    floorY = -100,
  ): void {
    const index = this.casingCursor++ % CASING_CAPACITY;
    const base = index * 3;
    this.casingLife[index] = CASING_LIFE_S;
    this.casingFloor[index] = floorY;
    this.casingBounces[index] = 0;
    this.casingResting[index] = 0;
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
    for (let index = 0; index < BURST_CAPACITY; index += 1) {
      const life = Math.max(0, this.burstLife[index]! - dtSeconds);
      this.burstLife[index] = life;
      if (life === 0) {
        this.bursts.setMatrixAt(index, HIDDEN_MATRIX);
        continue;
      }
      const base = index * 3;
      this.burstVelocity[base + 1] = this.burstVelocity[base + 1]! - 11 * dtSeconds;
      for (let axis = 0; axis < 3; axis += 1) {
        this.burstPosition[base + axis] =
          this.burstPosition[base + axis]! + this.burstVelocity[base + axis]! * dtSeconds;
      }
      this.position.fromArray(this.burstPosition, base);
      const fade = life / Math.max(0.001, this.burstMaxLife[index]!);
      this.scale.setScalar(0.4 + fade * 0.8);
      this.rotation.setFromAxisAngle(this.spinAxis, life * 18);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.bursts.setMatrixAt(index, this.matrix);
    }
    for (let index = 0; index < CASING_CAPACITY; index += 1) {
      const life = Math.max(0, this.casingLife[index]! - dtSeconds);
      this.casingLife[index] = life;
      if (life === 0) {
        this.casings.setMatrixAt(index, HIDDEN_MATRIX);
        continue;
      }
      const base = index * 3;
      // A rested casing lies still on the floor; only the end-of-life fade
      // still writes its matrix.
      if (this.casingResting[index] === 1) {
        if (life < 0.35) {
          this.position.fromArray(this.casingPosition, base);
          this.rotation.setFromAxisAngle(WORLD_X, Math.PI / 2);
          this.rollQuaternion.setFromAxisAngle(WORLD_UP, index * 2.399963);
          this.rollQuaternion.multiply(this.rotation);
          this.scale.setScalar(Math.max(0.05, life / 0.35));
          this.matrix.compose(this.position, this.rollQuaternion, this.scale);
          this.casings.setMatrixAt(index, this.matrix);
        }
        continue;
      }
      this.casingVelocity[base + 1] = this.casingVelocity[base + 1]! - 20 * dtSeconds;
      for (let axis = 0; axis < 3; axis += 1) {
        this.casingPosition[base + axis] =
          this.casingPosition[base + axis]! + this.casingVelocity[base + axis]! * dtSeconds;
      }
      // Floor contact (combat-fx-reference: casings used to SINK THROUGH the
      // floor): bounce with strong damping; the first contact is the brass
      // tinkle everyone knows from CS.
      const floorY = this.casingFloor[index]! + 0.033;
      if (this.casingPosition[base + 1]! < floorY && this.casingVelocity[base + 1]! < 0) {
        this.casingPosition[base + 1] = floorY;
        const verticalSpeed = -this.casingVelocity[base + 1]!;
        this.casingVelocity[base + 1] = verticalSpeed * 0.32;
        this.casingVelocity[base] = this.casingVelocity[base]! * 0.55;
        this.casingVelocity[base + 2] = this.casingVelocity[base + 2]! * 0.55;
        if (this.casingBounces[index] === 0 && this.onCasingBounce !== undefined) {
          this.onCasingBounce(
            this.casingPosition[base]!,
            this.casingPosition[base + 1]!,
            this.casingPosition[base + 2]!,
          );
        }
        this.casingBounces[index] = Math.min(255, this.casingBounces[index]! + 1);
        // Too slow to bounce visibly again: lie flat where it landed.
        if (verticalSpeed * 0.32 < 0.55) {
          this.casingResting[index] = 1;
          this.position.fromArray(this.casingPosition, base);
          this.rotation.setFromAxisAngle(WORLD_X, Math.PI / 2);
          this.rollQuaternion.setFromAxisAngle(WORLD_UP, index * 2.399963);
          this.rollQuaternion.multiply(this.rotation);
          this.scale.set(1, 1, 1);
          this.matrix.compose(this.position, this.rollQuaternion, this.scale);
          this.casings.setMatrixAt(index, this.matrix);
          continue;
        }
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
    this.bursts.instanceMatrix.needsUpdate = true;
    if (this.bursts.instanceColor !== null) this.bursts.instanceColor.needsUpdate = true;
    this.casings.instanceMatrix.needsUpdate = true;
  }

  private resetMatrices(mesh: InstancedMesh, capacity: number): void {
    for (let index = 0; index < capacity; index += 1) mesh.setMatrixAt(index, HIDDEN_MATRIX);
    mesh.instanceMatrix.needsUpdate = true;
  }
}
