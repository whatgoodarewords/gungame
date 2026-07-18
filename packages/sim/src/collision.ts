import type { MapCollision, Vec3 } from "@gungame/shared";
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

function toVector(value: Vec3): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}

function toVec3(value: Vector3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function capsuleSegment(position: Vec3, target = new Line3()): Line3 {
  target.start.set(position.x, position.y + CAPSULE_RADIUS, position.z);
  target.end.set(
    position.x,
    position.y + CAPSULE_HEIGHT - CAPSULE_RADIUS,
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

  constructor(collision: MapCollision) {
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
  }

  sweepCapsule(position: Vec3, displacement: Vec3): SweepHit | undefined {
    const delta = toVector(displacement);
    const distance = delta.length();
    if (distance <= COLLISION_EPSILON) return undefined;

    const startSegment = capsuleSegment(position);
    const endSegment = capsuleSegment({
      x: position.x + displacement.x,
      y: position.y + displacement.y,
      z: position.z + displacement.z,
    });
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

  slide(position: Vec3, velocity: Vec3, seconds: number): SlideResult {
    const currentPosition = toVector(position);
    const currentVelocity = toVector(velocity);
    let remainingSeconds = seconds;
    let blocked = false;
    const planes: Vector3[] = [];

    for (let iteration = 0; iteration < MAX_CLIP_ITERATIONS; iteration += 1) {
      if (remainingSeconds <= 0 || currentVelocity.lengthSq() <= COLLISION_EPSILON) break;
      const displacement = currentVelocity.clone().multiplyScalar(remainingSeconds);
      const hit = this.sweepCapsule(toVec3(currentPosition), toVec3(displacement));
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

  stepSlideMove(position: Vec3, velocity: Vec3, seconds: number): SlideResult {
    const displacementLength = Math.hypot(
      velocity.x * seconds,
      velocity.y * seconds,
      velocity.z * seconds,
    );
    const subSteps = Math.max(1, Math.ceil(displacementLength / CAPSULE_RADIUS));
    let result: SlideResult = { position, velocity, blocked: false };
    for (let index = 0; index < subSteps; index += 1) {
      const moved = this.stepSlideSubstep(result.position, result.velocity, seconds / subSteps);
      result = {
        position: moved.position,
        velocity: moved.velocity,
        blocked: result.blocked || moved.blocked,
      };
    }
    return result;
  }

  private stepSlideSubstep(position: Vec3, velocity: Vec3, seconds: number): SlideResult {
    const direct = this.slide(position, velocity, seconds);
    if (!direct.blocked || Math.hypot(velocity.x, velocity.z) <= COLLISION_EPSILON) {
      return direct;
    }

    const up = { x: 0, y: STEP_HEIGHT, z: 0 };
    const upHit = this.sweepCapsule(position, up);
    const upFraction = upHit?.time ?? 1;
    if (upFraction < 0.999) return direct;
    const horizontalLength = Math.hypot(velocity.x, velocity.z);
    const probeOrigin = new Vector3(
      direct.position.x + (velocity.x / horizontalLength) * (CAPSULE_RADIUS + SKIN * 2),
      position.y + STEP_HEIGHT + SKIN * 4,
      direct.position.z + (velocity.z / horizontalLength) * (CAPSULE_RADIUS + SKIN * 2),
    );
    const insideTopHit = this.bvh.raycastFirst(
      new Ray(probeOrigin, new Vector3(0, 1, 0)),
      DoubleSide,
      0,
      CAPSULE_RADIUS,
    );
    if (insideTopHit !== null) return direct;
    const topHit = this.bvh.raycastFirst(
      new Ray(probeOrigin, new Vector3(0, -1, 0)),
      DoubleSide,
      0,
      STEP_HEIGHT + SKIN * 8,
    );
    if (topHit === null) return direct;
    const obstacleTop = probeOrigin.y - topHit.distance;
    if (obstacleTop < position.y - SKIN || obstacleTop - position.y > STEP_HEIGHT + SKIN) {
      return direct;
    }
    const raised = { x: position.x, y: position.y + STEP_HEIGHT, z: position.z };
    const across = this.slide(raised, velocity, seconds);
    const steppedPosition = {
      x: across.position.x,
      y: obstacleTop,
      z: across.position.z,
    };
    const directDistance = (direct.position.x - position.x) ** 2 + (direct.position.z - position.z) ** 2;
    const stepDistance = (steppedPosition.x - position.x) ** 2 + (steppedPosition.z - position.z) ** 2;
    if (stepDistance <= directDistance + COLLISION_EPSILON) return direct;
    return { position: steppedPosition, velocity: across.velocity, blocked: true };
  }

  ground(position: Vec3, distance = 0.04): SweepHit | undefined {
    const hit = this.sweepCapsule(position, { x: 0, y: -distance, z: 0 });
    return hit !== undefined && hit.normal.y >= 0.7 ? hit : undefined;
  }
}
