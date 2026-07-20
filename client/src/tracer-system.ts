// Pooled instanced tracer streaks (combat-juice-spec J4). Replaces the per-shot
// BufferGeometry + setTimeout lines: zero allocation after construction, one
// draw call for every live tracer, and a color language chosen for the
// high-key daylight world — on a bright low-saturation register what reads is
// DARK + SATURATED + WARM, so the streak is deep ember with normal blending
// (additive/white/cyan all wash out against the sky).

import {
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Camera,
  type Scene,
} from "three/webgpu";
import { color } from "three/tsl";

const CAPACITY = 24;
const SPEED = 300; // m/s — reads hitscan-instant but the eye catches direction
const WIDTH = 0.022; // ≈2-3 px at 15 m on 768p
const MAX_STREAK = 5;
const MAX_LIFETIME_MS = 250; // pool safety

interface Slot {
  active: boolean;
  ageMs: number;
  distance: number;
  streak: number;
  from: Vector3;
  direction: Vector3;
}

export class TracerSystem {
  private readonly mesh: InstancedMesh;
  private readonly slots: Slot[] = [];
  private cursor = 0;
  private readonly scratchMatrix = new Matrix4();
  private readonly scratchQuat = new Quaternion();
  private readonly mid = new Vector3();
  private readonly toCamera = new Vector3();
  private readonly normal = new Vector3();
  private readonly binormal = new Vector3();
  private readonly basis = new Matrix4();
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);
  private readonly dummy = new Object3D();

  constructor(scene: Scene) {
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: DoubleSide,
    });
    material.colorNode = color(0xe25c12);
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, CAPACITY);
    this.mesh.name = "tracer-streaks-instanced";
    this.mesh.frustumCulled = false;
    for (let i = 0; i < CAPACITY; i += 1) {
      this.mesh.setMatrixAt(i, this.hidden);
      this.slots.push({
        active: false,
        ageMs: 0,
        distance: 0,
        streak: 0,
        from: new Vector3(),
        direction: new Vector3(),
      });
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  spawn(
    fromX: number, fromY: number, fromZ: number,
    toX: number, toY: number, toZ: number,
  ): void {
    const slot = this.slots[this.cursor]!;
    this.cursor = (this.cursor + 1) % CAPACITY;
    slot.from.set(fromX, fromY, fromZ);
    slot.direction.set(toX - fromX, toY - fromY, toZ - fromZ);
    slot.distance = slot.direction.length();
    if (slot.distance < 0.05) {
      slot.active = false;
      return;
    }
    slot.direction.divideScalar(slot.distance);
    slot.streak = Math.min(MAX_STREAK, slot.distance);
    slot.ageMs = 0;
    slot.active = true;
  }

  /** Per render frame: advance streak heads and re-orient toward the camera. */
  update(dtMs: number, camera: Camera): void {
    let any = false;
    for (let i = 0; i < CAPACITY; i += 1) {
      const slot = this.slots[i]!;
      if (!slot.active) continue;
      any = true;
      slot.ageMs += dtMs;
      const head = (slot.ageMs / 1_000) * SPEED;
      const tail = head - slot.streak;
      if (tail >= slot.distance || slot.ageMs > MAX_LIFETIME_MS) {
        slot.active = false;
        this.mesh.setMatrixAt(i, this.hidden);
        continue;
      }
      const clampedHead = Math.min(head, slot.distance);
      const clampedTail = Math.max(tail, 0);
      const length = Math.max(0.01, clampedHead - clampedTail);
      const center = (clampedHead + clampedTail) / 2;
      this.mid.copy(slot.from).addScaledVector(slot.direction, center);
      // Face the camera around the streak's long axis: X = direction,
      // Z = toward camera (orthogonalized), Y = their cross.
      this.toCamera.copy(camera.position).sub(this.mid).normalize();
      this.binormal.copy(slot.direction).cross(this.toCamera);
      if (this.binormal.lengthSq() < 1e-6) this.binormal.set(0, 1, 0);
      this.binormal.normalize();
      this.normal.copy(this.binormal).cross(slot.direction).normalize();
      this.basis.makeBasis(slot.direction, this.binormal, this.normal);
      this.scratchQuat.setFromRotationMatrix(this.basis);
      this.dummy.position.copy(this.mid);
      this.dummy.quaternion.copy(this.scratchQuat);
      this.dummy.scale.set(length, WIDTH, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(scene: Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}
