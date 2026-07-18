// First-person camera: applies view angles directly (input truth — no smoothing),
// eye height from the sim capsule, landing dip as the ONLY camera-side motion
// (§3.6: camera-only, ≤2°, ~60 ms — a grounding cue, not theater).

import { PerspectiveCamera } from "three";

const EYE_HEIGHT = 1.62;
const DIP_RADIANS = (2 * Math.PI) / 180;
const DIP_MS = 60;

export class FpsCamera {
  readonly camera: PerspectiveCamera;
  private dipT = 1; // 0 → dipping, 1 → settled

  constructor(aspect: number, fovDeg = 105) {
    this.camera = new PerspectiveCamera(fovDeg, aspect, 0.05, 500);
    this.camera.rotation.order = "YXZ";
  }

  setFov(deg: number): void {
    this.camera.fov = deg;
    this.camera.updateProjectionMatrix();
  }

  onLand(): void {
    this.dipT = 0;
  }

  /** Per render frame. Position from interpolated sim state; angles raw from input. */
  update(
    px: number,
    py: number,
    pz: number,
    yaw: number,
    pitch: number,
    dtMs: number,
  ): void {
    let dip = 0;
    if (this.dipT < 1) {
      this.dipT = Math.min(1, this.dipT + dtMs / DIP_MS);
      dip = Math.sin(this.dipT * Math.PI) * DIP_RADIANS;
    }
    this.camera.position.set(px, py + EYE_HEIGHT, pz);
    this.camera.rotation.set(pitch - dip, yaw, 0);
  }
}
