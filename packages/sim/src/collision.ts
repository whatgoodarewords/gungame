import type { MapAabb, MapCollision, Vec3 } from "@gungame/shared";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Line3,
  Ray,
  Vector3,
} from "three";
import { MeshBVH, type ExtendedTriangle } from "three-mesh-bvh";

export const CAPSULE_RADIUS = 0.4 as const;
export const CAPSULE_HEIGHT = 1.8 as const;
export const DUCKED_CAPSULE_HEIGHT = 0.9 as const;
export const EYE_HEIGHT = 1.62 as const;
export const STEP_HEIGHT = 0.45 as const;
export const MAX_CLIP_ITERATIONS = 4 as const;

const COLLISION_EPSILON = 1e-7;
const TIME_EPSILON = 1e-6;
const SKIN = 1e-5;
const CAST_ITERATIONS = 20;

export interface SweepHit {
  readonly time: number;
  readonly normal: Vec3;
}

export interface SlideResult {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly blocked: boolean;
}

export interface MoveCollisionOptions {
  readonly height?: number;
  readonly bottomOffset?: number;
  readonly allowStep?: boolean;
  readonly cornerNudge?: number;
}

function toVector(value: Vec3): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}

function toVec3(value: Vector3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function capsuleSegment(
  position: Vec3,
  height: number = CAPSULE_HEIGHT,
  bottomOffset: number = 0,
  target = new Line3(),
): Line3 {
  target.start.set(
    position.x,
    position.y + bottomOffset + CAPSULE_RADIUS,
    position.z,
  );
  target.end.set(
    position.x,
    position.y + bottomOffset + height - CAPSULE_RADIUS,
    position.z,
  );
  return target;
}

function clipVelocity(velocity: Vector3, normal: Vector3): void {
  const into = velocity.dot(normal);
  if (into < 0) velocity.addScaledVector(normal, -into);
}

export class CollisionWorld {
  readonly geometry: BufferGeometry;
  readonly bvh: MeshBVH;
  readonly killVolumes: readonly MapAabb[];

  constructor(collision: MapCollision, killVolumes: readonly MapAabb[] = []) {
    if (collision.positions.length % 3 !== 0 || collision.indices.length % 3 !== 0) {
      throw new RangeError("collision geometry must contain xyz vertices and triangles");
    }
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new BufferAttribute(collision.positions.slice(), 3, false),
    );
    this.geometry.setIndex(
      new BufferAttribute(collision.indices.slice(), 1, false),
    );
    this.bvh = new MeshBVH(this.geometry, {
      indirect: true,
      maxDepth: 40,
      targetLeafSize: 10,
      setBoundingBox: true,
      strategy: 0,
    });
    this.killVolumes = killVolumes;
  }

  sweepCapsule(
    position: Vec3,
    displacement: Vec3,
    height: number = CAPSULE_HEIGHT,
    bottomOffset: number = 0,
  ): SweepHit | undefined {
    const delta = toVector(displacement);
    const distance = delta.length();
    if (distance <= COLLISION_EPSILON) return undefined;

    const startSegment = capsuleSegment(position, height, bottomOffset);
    const endSegment = capsuleSegment({
      x: position.x + displacement.x,
      y: position.y + displacement.y,
      z: position.z + displacement.z,
    }, height, bottomOffset);
    const sweptBounds = new Box3().setFromPoints([
      startSegment.start,
      startSegment.end,
      endSegment.start,
      endSegment.end,
    ]).expandByScalar(CAPSULE_RADIUS + SKIN);
    const segment = new Line3();
    const trianglePoint = new Vector3();
    const capsulePoint = new Vector3();
    const triangleNormal = new Vector3();
    let earliest = Infinity;
    let earliestNormal: Vector3 | undefined;

    this.bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(sweptBounds),
      intersectsTriangle: (triangle: ExtendedTriangle) => {
        let time = 0;
        for (let iteration = 0; iteration < CAST_ITERATIONS && time <= 1; iteration += 1) {
          segment.start.copy(startSegment.start).addScaledVector(delta, time);
          segment.end.copy(startSegment.end).addScaledVector(delta, time);
          const separation = triangle.closestPointToSegment(
            segment,
            trianglePoint,
            capsulePoint,
          );
          if (separation <= CAPSULE_RADIUS + SKIN) {
            const normal = capsulePoint.clone().sub(trianglePoint);
            if (normal.lengthSq() <= COLLISION_EPSILON * COLLISION_EPSILON) {
              triangle.getNormal(triangleNormal);
              normal.copy(triangleNormal);
              if (normal.dot(delta) > 0) normal.negate();
            } else {
              normal.normalize();
            }
            if (delta.dot(normal) < -COLLISION_EPSILON && time < earliest) {
              earliest = time;
              earliestNormal = normal;
            }
            break;
          }
          const advance = (separation - CAPSULE_RADIUS) / distance;
          if (advance <= TIME_EPSILON) break;
          time += advance;
          if (time >= earliest) break;
        }
        return false;
      },
    });

    return earliestNormal === undefined
      ? undefined
      : { time: Math.max(0, Math.min(1, earliest)), normal: toVec3(earliestNormal) };
  }

  capsuleFits(
    position: Vec3,
    height: number = CAPSULE_HEIGHT,
    bottomOffset: number = 0,
  ): boolean {
    const segment = capsuleSegment(position, height, bottomOffset);
    const bounds = new Box3().setFromPoints([
      segment.start,
      segment.end,
    ]).expandByScalar(CAPSULE_RADIUS);
    const trianglePoint = new Vector3();
    const capsulePoint = new Vector3();
    let intersects = false;
    this.bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(bounds),
      intersectsTriangle: (triangle: ExtendedTriangle) => {
        const separation = triangle.closestPointToSegment(
          segment,
          trianglePoint,
          capsulePoint,
        );
        if (separation < CAPSULE_RADIUS - SKIN) intersects = true;
        return intersects;
      },
    });
    return !intersects;
  }

  private crossesKillVolume(
    position: Vec3,
    displacement: Vec3,
    height: number,
    bottomOffset: number,
  ): boolean {
    if (this.killVolumes.length === 0) return false;
    const start = capsuleSegment(position, height, bottomOffset);
    const end = capsuleSegment({
      x: position.x + displacement.x,
      y: position.y + displacement.y,
      z: position.z + displacement.z,
    }, height, bottomOffset);
    const swept = new Box3().setFromPoints([
      start.start,
      start.end,
      end.start,
      end.end,
    ]).expandByScalar(CAPSULE_RADIUS);
    return this.killVolumes.some((volume) => swept.intersectsBox(new Box3(
      toVector(volume.min),
      toVector(volume.max),
    )));
  }

  slide(
    position: Vec3,
    velocity: Vec3,
    seconds: number,
    height: number = CAPSULE_HEIGHT,
    bottomOffset: number = 0,
  ): SlideResult {
    const currentPosition = toVector(position);
    const currentVelocity = toVector(velocity);
    let remainingSeconds = seconds;
    let blocked = false;
    const planes: Vector3[] = [];

    for (let iteration = 0; iteration < MAX_CLIP_ITERATIONS; iteration += 1) {
      if (remainingSeconds <= 0 || currentVelocity.lengthSq() <= COLLISION_EPSILON) break;
      const displacement = currentVelocity.clone().multiplyScalar(remainingSeconds);
      const hit = this.sweepCapsule(
        toVec3(currentPosition),
        toVec3(displacement),
        height,
        bottomOffset,
      );
      if (hit === undefined) {
        currentPosition.add(displacement);
        remainingSeconds = 0;
        break;
      }
      blocked = true;
      const moveTime = Math.max(0, hit.time - SKIN / Math.max(displacement.length(), SKIN));
      currentPosition.addScaledVector(displacement, moveTime);
      remainingSeconds *= 1 - hit.time;
      const normal = toVector(hit.normal);
      planes.push(normal);
      for (const plane of planes) clipVelocity(currentVelocity, plane);
    }

    return {
      position: toVec3(currentPosition),
      velocity: toVec3(currentVelocity),
      blocked,
    };
  }

  stepSlideMove(
    position: Vec3,
    velocity: Vec3,
    seconds: number,
    options: MoveCollisionOptions = {},
  ): SlideResult {
    const height = options.height ?? CAPSULE_HEIGHT;
    const bottomOffset = options.bottomOffset ?? 0;
    const displacementLength = Math.hypot(
      velocity.x * seconds,
      velocity.y * seconds,
      velocity.z * seconds,
    );
    const subSteps = Math.max(1, Math.ceil(displacementLength / CAPSULE_RADIUS));
    let result: SlideResult = { position, velocity, blocked: false };
    let cornerCorrectionAvailable = (options.cornerNudge ?? 0) > 0;
    for (let index = 0; index < subSteps; index += 1) {
      const moved = this.stepSlideSubstep(
        result.position,
        result.velocity,
        seconds / subSteps,
        height,
        bottomOffset,
        options.allowStep ?? true,
        cornerCorrectionAvailable ? options.cornerNudge ?? 0 : 0,
      );
      if (moved.cornerCorrected) cornerCorrectionAvailable = false;
      result = {
        position: moved.position,
        velocity: moved.velocity,
        blocked: result.blocked || moved.blocked,
      };
    }
    return result;
  }

  private stepSlideSubstep(
    position: Vec3,
    velocity: Vec3,
    seconds: number,
    height: number,
    bottomOffset: number,
    allowStep: boolean,
    cornerNudge: number,
  ): SlideResult & { readonly cornerCorrected: boolean } {
    const displacement = {
      x: velocity.x * seconds,
      y: velocity.y * seconds,
      z: velocity.z * seconds,
    };
    if (cornerNudge > 0) {
      const initialHit = this.sweepCapsule(
        position,
        displacement,
        height,
        bottomOffset,
      );
      if (initialHit !== undefined) {
        const horizontalLength = Math.hypot(displacement.x, displacement.z);
        const candidates: Vec3[] = [];
        if (horizontalLength > COLLISION_EPSILON) {
          const perpendicular = {
            x: (-displacement.z / horizontalLength) * cornerNudge,
            y: 0,
            z: (displacement.x / horizontalLength) * cornerNudge,
          };
          candidates.push(perpendicular, {
            x: -perpendicular.x,
            y: 0,
            z: -perpendicular.z,
          });
        }
        if (initialHit.normal.y <= 0) {
          candidates.push({ x: 0, y: cornerNudge, z: 0 });
        }
        for (const offset of candidates) {
          const nudgedPosition = {
            x: position.x + offset.x,
            y: position.y + offset.y,
            z: position.z + offset.z,
          };
          if (
            this.sweepCapsule(position, offset, height, bottomOffset) === undefined &&
            this.sweepCapsule(nudgedPosition, displacement, height, bottomOffset) === undefined &&
            !this.crossesKillVolume(position, offset, height, bottomOffset) &&
            !this.crossesKillVolume(nudgedPosition, displacement, height, bottomOffset)
          ) {
            return {
              position: {
                x: nudgedPosition.x + displacement.x,
                y: nudgedPosition.y + displacement.y,
                z: nudgedPosition.z + displacement.z,
              },
              velocity,
              blocked: true,
              cornerCorrected: true,
            };
          }
        }
      }
    }

    const direct = this.slide(position, velocity, seconds, height, bottomOffset);
    if (
      !allowStep ||
      !direct.blocked ||
      Math.hypot(velocity.x, velocity.z) <= COLLISION_EPSILON
    ) {
      return { ...direct, cornerCorrected: false };
    }

    const up = { x: 0, y: STEP_HEIGHT, z: 0 };
    const upHit = this.sweepCapsule(position, up, height, bottomOffset);
    const upFraction = upHit?.time ?? 1;
    if (upFraction < 0.999) return { ...direct, cornerCorrected: false };
    const horizontalLength = Math.hypot(velocity.x, velocity.z);
    const footY = position.y + bottomOffset;
    const probeOrigin = new Vector3(
      direct.position.x + (velocity.x / horizontalLength) * (CAPSULE_RADIUS + SKIN * 2),
      footY + STEP_HEIGHT + SKIN * 4,
      direct.position.z + (velocity.z / horizontalLength) * (CAPSULE_RADIUS + SKIN * 2),
    );
    const insideTopHit = this.bvh.raycastFirst(
      new Ray(probeOrigin, new Vector3(0, 1, 0)),
      DoubleSide,
      0,
      CAPSULE_RADIUS,
    );
    if (insideTopHit !== null) return { ...direct, cornerCorrected: false };
    const topHit = this.bvh.raycastFirst(
      new Ray(probeOrigin, new Vector3(0, -1, 0)),
      DoubleSide,
      0,
      STEP_HEIGHT + SKIN * 8,
    );
    if (topHit === null) return { ...direct, cornerCorrected: false };
    const obstacleTop = probeOrigin.y - topHit.distance;
    if (obstacleTop < footY - SKIN || obstacleTop - footY > STEP_HEIGHT + SKIN) {
      return { ...direct, cornerCorrected: false };
    }
    const raised = { x: position.x, y: position.y + STEP_HEIGHT, z: position.z };
    const across = this.slide(raised, velocity, seconds, height, bottomOffset);
    const steppedPosition = {
      x: across.position.x,
      y: obstacleTop - bottomOffset,
      z: across.position.z,
    };
    const directDistance = (direct.position.x - position.x) ** 2 + (direct.position.z - position.z) ** 2;
    const stepDistance = (steppedPosition.x - position.x) ** 2 + (steppedPosition.z - position.z) ** 2;
    if (stepDistance <= directDistance + COLLISION_EPSILON) {
      return { ...direct, cornerCorrected: false };
    }
    return {
      position: steppedPosition,
      velocity: across.velocity,
      blocked: true,
      cornerCorrected: false,
    };
  }

  ground(
    position: Vec3,
    distance = 0.04,
    height: number = CAPSULE_HEIGHT,
    bottomOffset: number = 0,
  ): SweepHit | undefined {
    const hit = this.sweepCapsule(
      position,
      { x: 0, y: -distance, z: 0 },
      height,
      bottomOffset,
    );
    return hit !== undefined && hit.normal.y >= 0.7 ? hit : undefined;
  }
}
