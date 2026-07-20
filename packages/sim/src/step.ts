/**
 * Fixed-tick movement. The base acceleration and slide movement are clean-room
 * Q3-style implementations; duck ordering and Phase 1c subtleties follow the
 * project specification's transcription of GoldSrc pmove behavior.
 */
import {
  DEFAULT_FEEL,
  TICK_DT,
  type FeelParams,
  type ResolvedFeelParams,
  type Vec3,
} from "@gungame/shared";

import {
  CAPSULE_HEIGHT,
  CollisionWorld,
  DUCKED_CAPSULE_HEIGHT,
  type SweepHit,
} from "./collision.js";
import { DEFAULT, type MoveParams } from "./params.js";
import { Buttons, type Cmd, type State } from "./types.js";

const AIRBORNE_UPWARD_VELOCITY = 4.6;

export interface StepOptions {
  readonly world?: CollisionWorld;
  readonly params?: MoveParams;
  readonly feel?: FeelParams;
  /** Backward-compatible alias used by the Phase 1 client bridge. */
  readonly bufferMs?: number;
}

interface GroundState {
  readonly grounded: boolean;
  readonly hit: SweepHit | undefined;
  readonly hasSupport: boolean;
}

function pressed(buttons: number, button: number): number {
  return (buttons & button) === 0 ? 0 : 1;
}

function wishVelocity(cmd: Cmd, runSpeed: number): { direction: Vec3; speed: number } {
  const forwardInput = pressed(cmd.buttons, Buttons.Forward) - pressed(cmd.buttons, Buttons.Backward);
  const rightInput = pressed(cmd.buttons, Buttons.Right) - pressed(cmd.buttons, Buttons.Left);
  const inputLength = Math.hypot(forwardInput, rightInput);
  if (inputLength === 0) return { direction: { x: 0, y: 0, z: 0 }, speed: 0 };
  const yaw = (cmd.viewYaw * Math.PI) / 180;
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const scale = 1 / inputLength;
  return {
    direction: {
      x: (forwardX * forwardInput + rightX * rightInput) * scale,
      y: 0,
      z: (forwardZ * forwardInput + rightZ * rightInput) * scale,
    },
    speed: runSpeed,
  };
}

function friction(velocity: Vec3, amount: number, dt: number, stopSpeed: number): Vec3 {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed === 0) return velocity;
  // Q3 pmove: clamp the control value so low-speed deceleration is linear
  // and actually reaches zero (pm_stopspeed) instead of asymptotic drift.
  const control = Math.max(speed, stopSpeed);
  const newSpeed = Math.max(0, speed - control * amount * dt);
  const scale = newSpeed / speed;
  return { x: velocity.x * scale, y: velocity.y, z: velocity.z * scale };
}

function accelerate(
  velocity: Vec3,
  wishDirection: Vec3,
  wishSpeed: number,
  acceleration: number,
  dt: number,
): Vec3 {
  const projectedSpeed =
    velocity.x * wishDirection.x +
    velocity.y * wishDirection.y +
    velocity.z * wishDirection.z;
  const available = wishSpeed - projectedSpeed;
  if (available <= 0) return velocity;
  const added = Math.min(available, acceleration * wishSpeed * dt);
  return {
    x: velocity.x + wishDirection.x * added,
    y: velocity.y + wishDirection.y * added,
    z: velocity.z + wishDirection.z * added,
  };
}

function projectDirectionOnGround(direction: Vec3, normal: Vec3): Vec3 {
  const dot = direction.x * normal.x + direction.y * normal.y + direction.z * normal.z;
  const projected = {
    x: direction.x - normal.x * dot,
    y: direction.y - normal.y * dot,
    z: direction.z - normal.z * dot,
  };
  const length = Math.hypot(projected.x, projected.y, projected.z);
  return length === 0
    ? { x: 0, y: 0, z: 0 }
    : { x: projected.x / length, y: projected.y / length, z: projected.z / length };
}

function clipVelocity(velocity: Vec3, normal: Vec3): Vec3 {
  const into = velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z;
  if (into >= 0) return velocity;
  return {
    x: velocity.x - normal.x * into,
    y: velocity.y - normal.y * into,
    z: velocity.z - normal.z * into,
  };
}

function ticksFor(milliseconds: number): number {
  return Math.ceil(milliseconds / (TICK_DT * 1000));
}

function hull(ducked: boolean, feetTuck: number): {
  readonly height: number;
  readonly bottomOffset: number;
} {
  return ducked
    ? { height: DUCKED_CAPSULE_HEIGHT, bottomOffset: feetTuck }
    : { height: CAPSULE_HEIGHT, bottomOffset: 0 };
}

function categorizeGround(
  world: CollisionWorld | undefined,
  position: Vec3,
  velocity: Vec3,
  ducked: boolean,
  feetTuck: number,
  fallbackGrounded: boolean,
): GroundState {
  if (world === undefined) {
    const hasSupport = fallbackGrounded;
    return {
      grounded: hasSupport && velocity.y <= AIRBORNE_UPWARD_VELOCITY,
      hit: undefined,
      hasSupport,
    };
  }
  const playerHull = hull(ducked, feetTuck);
  const hit = world.ground(
    position,
    0.04,
    playerHull.height,
    playerHull.bottomOffset,
  );
  return {
    grounded: hit !== undefined && velocity.y <= AIRBORNE_UPWARD_VELOCITY,
    hit,
    hasSupport: hit !== undefined,
  };
}

function validateFeel(feel: ResolvedFeelParams): void {
  const nonNegative = [
    ["jumpBufferMs", feel.jumpBufferMs],
    ["duckTransitionMs", feel.duckTransitionMs],
    ["feetTuck", feel.feetTuck],
    ["coyoteMs", feel.coyoteMs],
    ["cornerNudge", feel.cornerNudge],
    ["slideMs", feel.slideMs],
  ] as const;
  for (const [name, value] of nonNegative) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative finite value`);
    }
  }
  for (const [name, value] of [
    ["duckSpeedScale", feel.duckSpeedScale],
    ["slideFrictionScale", feel.slideFrictionScale],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`${name} must be a finite value in [0, 1]`);
    }
  }
}

export function step(
  state: State,
  cmd: Cmd,
  dt: number,
  options: StepOptions = {},
): State {
  if (dt !== TICK_DT) {
    throw new RangeError(`simulation dt must be exactly 1/64 (${TICK_DT})`);
  }
  const params = options.params ?? DEFAULT;
  const feel: ResolvedFeelParams = {
    ...DEFAULT_FEEL,
    ...options.feel,
    ...(options.bufferMs === undefined ? {} : { jumpBufferMs: options.bufferMs }),
  };
  validateFeel(feel);
  const world = options.world;

  const jumpDown = (cmd.buttons & Buttons.Jump) !== 0;
  const jumpPressed = jumpDown && !state.player.jumpButtonDown;
  let jumpBufferTicks = jumpPressed
    ? ticksFor(feel.jumpBufferMs)
    : Math.max(0, state.player.jumpBufferTicks - 1);
  let position = state.player.position;
  let velocity = state.player.velocity;
  let ducked = state.player.ducked;
  let duckProgress = state.player.duckProgress;
  let coyoteTicksLeft = state.player.coyoteTicksLeft;
  let slideTicksLeft = state.player.slideTicksLeft;

  // 1. Categorize ground.
  let ground = categorizeGround(
    world,
    position,
    velocity,
    ducked,
    feel.feetTuck,
    state.player.grounded,
  );
  let grounded = ground.grounded;
  let coyoteStartedThisTick = false;
  if (grounded) {
    coyoteTicksLeft = 0;
  } else if (state.player.grounded && !ground.hasSupport) {
    coyoteTicksLeft = ticksFor(feel.coyoteMs);
    coyoteStartedThisTick = true;
  }

  // 2. Duck/unduck. Ground duck transitions keep the standing hull until done.
  const duckDown = (cmd.buttons & Buttons.Duck) !== 0;
  let hullChanged = false;
  if (duckDown && !ducked) {
    if (grounded) {
      duckProgress = feel.duckTransitionMs === 0
        ? 1
        : Math.min(1, duckProgress + dt * 1000 / feel.duckTransitionMs);
      if (duckProgress >= 1) {
        ducked = true;
        position = { ...position, y: position.y - feel.feetTuck };
        hullChanged = true;
      }
    } else {
      ducked = true;
      duckProgress = 1;
      hullChanged = true;
    }
  } else if (!duckDown && ducked) {
    if (grounded) {
      const standingPosition = { ...position, y: position.y + feel.feetTuck };
      if (world === undefined || world.capsuleFits(standingPosition)) {
        position = standingPosition;
        ducked = false;
        duckProgress = 0;
        hullChanged = true;
      }
    } else {
      // Air ducking tucks the hull without moving the origin. Only restore the
      // standing hull if it fits at that exact position; this still permits a
      // jumpbug when the newly lowered feet meet a fitting surface.
      if (world === undefined || world.capsuleFits(position)) {
        ducked = false;
        duckProgress = 0;
        hullChanged = true;
      }
    }
  } else if (!duckDown && !ducked) {
    duckProgress = 0;
  } else if (ducked) {
    duckProgress = 1;
  }

  // Air-unduck can lower the feet onto a surface (jumpbug), so recategorize now.
  if (hullChanged) {
    ground = categorizeGround(
      world,
      position,
      velocity,
      ducked,
      feel.feetTuck,
      grounded,
    );
    grounded = ground.grounded;
    if (grounded) coyoteTicksLeft = 0;
  }

  // 3. Jump check. De-grounding here deliberately precedes friction.
  const canJump = grounded || coyoteTicksLeft > 0;
  const jumped = canJump && jumpBufferTicks > 0;
  if (jumped) {
    velocity = { ...velocity, y: params.jumpVelocity };
    grounded = false;
    ground = { grounded: false, hit: undefined, hasSupport: false };
    jumpBufferTicks = 0;
    coyoteTicksLeft = 0;
  }

  const groundedBeforeMove = grounded;
  // 4. Friction, grounded only. 5. Ground/air acceleration, then gravity.
  const wish = wishVelocity(
    cmd,
    params.runSpeed * (ducked ? feel.duckSpeedScale : 1),
  );
  if (grounded) {
    const sliding = slideTicksLeft > 0;
    velocity = friction(
      velocity,
      params.friction * (sliding ? feel.slideFrictionScale : 1),
      dt,
      params.stopSpeed,
    );
    if (!sliding || Math.hypot(velocity.x, velocity.z) < params.runSpeed) {
      const groundDirection = ground.hit === undefined
        ? wish.direction
        : projectDirectionOnGround(wish.direction, ground.hit.normal);
      velocity = accelerate(
        velocity,
        groundDirection,
        wish.speed,
        params.groundAccelerate,
        dt,
      );
    }
    if (ground.hit !== undefined) velocity = clipVelocity(velocity, ground.hit.normal);
  } else {
    velocity = accelerate(
      velocity,
      wish.direction,
      wish.speed,
      params.airAccelerate,
      dt,
    );
    velocity = { ...velocity, y: velocity.y - params.gravity * dt };
  }

  // 6. Move/collide.
  const playerHull = hull(ducked, feel.feetTuck);
  const movement = world === undefined
    ? {
        position: {
          x: position.x + velocity.x * dt,
          y: position.y + velocity.y * dt,
          z: position.z + velocity.z * dt,
        },
        velocity,
      }
    : world.stepSlideMove(position, velocity, dt, {
        height: playerHull.height,
        bottomOffset: playerHull.bottomOffset,
        allowStep: grounded,
        cornerNudge: grounded ? 0 : feel.cornerNudge,
      });

  // 7. Categorize ground again.
  const finalGround = categorizeGround(
    world,
    movement.position,
    movement.velocity,
    ducked,
    feel.feetTuck,
    world === undefined ? grounded : false,
  );
  grounded = finalGround.grounded;
  velocity = movement.velocity;
  if (grounded && velocity.y < 0 && finalGround.hit !== undefined) {
    velocity = clipVelocity(velocity, finalGround.hit.normal);
  }

  const landed = !groundedBeforeMove && grounded;
  if (
    landed &&
    ducked &&
    Math.hypot(velocity.x, velocity.z) > params.runSpeed
  ) {
    slideTicksLeft = ticksFor(feel.slideMs);
  } else if (slideTicksLeft > 0) {
    slideTicksLeft -= 1;
  }

  if (grounded) {
    coyoteTicksLeft = 0;
  } else if (groundedBeforeMove && !jumped) {
    coyoteTicksLeft = ticksFor(feel.coyoteMs);
    coyoteStartedThisTick = true;
  } else if (!coyoteStartedThisTick && coyoteTicksLeft > 0) {
    coyoteTicksLeft -= 1;
  }

  return {
    tick: state.tick + 1,
    player: {
      ...state.player,
      position: movement.position,
      velocity,
      viewYaw: cmd.viewYaw,
      viewPitch: cmd.viewPitch,
      grounded,
      jumpBufferTicks,
      jumpButtonDown: jumpDown,
      ducked,
      duckProgress,
      coyoteTicksLeft,
      slideTicksLeft,
    },
  };
}
