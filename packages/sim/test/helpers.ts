import { CollisionWorld, type Cmd, type PlayerState, type State } from "../src/index.js";

export interface BoxSpec {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export function worldFromBoxes(boxes: readonly BoxSpec[]): CollisionWorld {
  const positions: number[] = [];
  const indices: number[] = [];
  const faces = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
    0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ] as const;
  for (const box of boxes) {
    const [minX, minY, minZ] = box.min;
    const [maxX, maxY, maxZ] = box.max;
    const base = positions.length / 3;
    positions.push(
      minX, minY, minZ, maxX, minY, minZ, maxX, maxY, minZ, minX, maxY, minZ,
      minX, minY, maxZ, maxX, minY, maxZ, maxX, maxY, maxZ, minX, maxY, maxZ,
    );
    indices.push(...faces.map((index) => base + index));
  }
  return new CollisionWorld({
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
  });
}

export function cmd(tick: number, buttons = 0, viewYaw = 0): Cmd {
  return {
    seq: tick + 1,
    tick,
    buttons,
    viewYaw,
    viewPitch: 0,
    fireFraction: 0,
    lastSnapshotTick: 0,
    interpTargetTick: 0,
    interpTargetFraction: 0,
  };
}

export function withPlayer(state: State, player: Partial<PlayerState>): State {
  return { ...state, player: { ...state.player, ...player } };
}
