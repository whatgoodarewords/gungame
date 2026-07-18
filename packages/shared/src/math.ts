// Vec3 is an object because Phase 0 prioritizes readable state/replay snapshots;
// the movement phase can profile storage before choosing a denser representation.
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const VEC3_ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Scale(value: Vec3, scalar: number): Vec3 {
  return {
    x: value.x * scalar,
    y: value.y * scalar,
    z: value.z * scalar,
  };
}

export function vec3AddScaled(origin: Vec3, delta: Vec3, scalar: number): Vec3 {
  return vec3Add(origin, vec3Scale(delta, scalar));
}

export function vec3Length(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z);
}
