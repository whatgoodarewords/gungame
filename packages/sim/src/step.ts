/**
 * Clean-room Q3-style movement based only on published algorithm descriptions:
 * - Mattias Gustavsson, “Quake 3 movement”.
 * - Adrian Biagioli, “Bunnyhopping from the Programmer's Perspective”
 *   https://adrianb.io/2015/02/14/bunnyhop.html
 * No Quake, ioquake3, or other GPL/GPL-derived source was consulted.
 */
import {
  DEFAULT_JUMP_BUFFER_MS,
  TICK_DT,
  type Vec3,
} from "@gungame/shared";

import { CollisionWorld } from "./collision.js";
import { DEFAULT, type MoveParams } from "./params.js";
import { Buttons, type Cmd, type State } from "./types.js";

const MAX_WALKABLE_NORMAL_Y = 0.7;

export interface StepOptions {
  readonly world?: CollisionWorld;
  readonly params?: MoveParams;
  readonly bufferMs?: number;
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

function friction(velocity: Vec3, amount: number, dt: number): Vec3 {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed === 0) return velocity;
  const newSpeed = Math.max(0, speed - speed * amount * dt);
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

function clipToGround(velocity: Vec3, normal: Vec3): Vec3 {
  const into = velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z;
  if (into >= 0) return velocity;
  return {
    x: velocity.x - normal.x * into,
    y: velocity.y - normal.y * into,
    z: velocity.z - normal.z * into,
  };
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
  const world = options.world;
  const bufferMs = options.bufferMs ?? DEFAULT_JUMP_BUFFER_MS;
  if (!Number.isFinite(bufferMs) || bufferMs < 0) {
    throw new RangeError("jump buffer must be a non-negative finite duration");
  }

  const jumpDown = (cmd.buttons & Buttons.Jump) !== 0;
  const jumpPressed = jumpDown && !state.player.jumpButtonDown;
  const bufferTicks = Math.ceil(bufferMs / (TICK_DT * 1000));
  let jumpBufferTicks = jumpPressed
    ? bufferTicks
    : Math.max(0, state.player.jumpBufferTicks - 1);
  const groundHit = world?.ground(state.player.position);
  let grounded = groundHit !== undefined || (world === undefined && state.player.grounded);
  const shouldJump = grounded && jumpBufferTicks > 0;
  const wish = wishVelocity(cmd, params.runSpeed);
  let velocity = state.player.velocity;

  if (grounded && !shouldJump) {
    velocity = friction(velocity, params.friction, dt);
    const groundDirection =
      groundHit === undefined
        ? wish.direction
        : projectDirectionOnGround(wish.direction, groundHit.normal);
    velocity = accelerate(
      velocity,
      groundDirection,
      wish.speed,
      params.groundAccelerate,
      dt,
    );
    if (groundHit !== undefined && groundHit.normal.y >= MAX_WALKABLE_NORMAL_Y) {
      velocity = clipToGround(velocity, groundHit.normal);
    }
  } else {
    if (shouldJump) {
      velocity = { ...velocity, y: params.jumpVelocity };
      grounded = false;
      jumpBufferTicks = 0;
    }
    velocity = accelerate(
      velocity,
      wish.direction,
      wish.speed,
      params.airAccelerate,
      dt,
    );
    velocity = { ...velocity, y: velocity.y - params.gravity * dt };
  }

  const movement =
    world === undefined
      ? {
          position: {
            x: state.player.position.x + velocity.x * dt,
            y: state.player.position.y + velocity.y * dt,
            z: state.player.position.z + velocity.z * dt,
          },
          velocity,
        }
      : world.stepSlideMove(state.player.position, velocity, dt);
  const finalGround = world?.ground(movement.position);
  grounded = finalGround !== undefined;
  velocity = movement.velocity;
  if (grounded && velocity.y < 0 && finalGround !== undefined) {
    velocity = clipToGround(velocity, finalGround.normal);
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
    },
  };
}
