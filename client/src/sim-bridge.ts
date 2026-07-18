import {
  DEFAULT_FEEL,
  loadGameplayMap,
  TICK_DT,
  type FeelParams,
} from "../../packages/shared/src/index.js";
import {
  CollisionWorld,
  createInitialState,
  DEFAULT,
  step as stepSimulation,
  type Cmd,
  type MoveParams,
  type State,
} from "../../packages/sim/src/index.js";

export interface FrameInput {
  readonly buttons: number;
  readonly viewYaw: number;
  readonly viewPitch: number;
  readonly fireFraction?: number;
  readonly lastSnapshotTick?: number;
  readonly interpTargetTick?: number;
  readonly interpTargetFraction?: number;
}

export interface SimHandle {
  step(): void;
  getState(): State;
  /** State one tick behind, for render interpolation. */
  getPrevState(): State;
  /** Fraction [0,1) of the current tick elapsed, for render interpolation. */
  getAlpha(): number;
  setParams(params: MoveParams): void;
  setFeel(feel: FeelParams): void;
  applyInput(frameInput: FrameInput): void;
}

const EMPTY_INPUT: FrameInput = Object.freeze({
  buttons: 0,
  viewYaw: 0,
  viewPitch: 0,
});

export function createPlayground(
  canvas: HTMLCanvasElement,
  blobUrl?: string,
): { sim: SimHandle } {
  // The bridge deliberately treats the canvas as an opaque ownership token.
  void canvas;

  let state = createInitialState();
  let prevState = state;
  let world: CollisionWorld | undefined;
  let params: MoveParams = DEFAULT;
  let feel: FeelParams = DEFAULT_FEEL;
  let input = EMPTY_INPUT;

  const tick = (): void => {
    if (world === undefined) return;
    prevState = state;
    const cmd: Cmd = {
      seq: state.tick + 1,
      tick: state.tick,
      buttons: input.buttons,
      viewYaw: input.viewYaw,
      viewPitch: input.viewPitch,
      fireFraction: input.fireFraction ?? 0,
      lastSnapshotTick: input.lastSnapshotTick ?? 0,
      interpTargetTick: input.interpTargetTick ?? 0,
      interpTargetFraction: input.interpTargetFraction ?? 0,
    };
    state = stepSimulation(state, cmd, TICK_DT, {
      world,
      params,
      bufferMs: feel.jumpBufferMs,
    });
  };

  const sim: SimHandle = {
    step: tick,
    getState: () => state,
    getPrevState: () => prevState,
    getAlpha: () => Math.min(1, accumulator / TICK_DT),
    setParams: (nextParams) => {
      params = { ...nextParams };
    },
    setFeel: (nextFeel) => {
      feel = { ...nextFeel };
    },
    applyInput: (frameInput) => {
      input = { ...frameInput };
    },
  };

  void fetch(blobUrl ?? new URL("../../maps/greybox.blob", import.meta.url))
    .then(async (response) => {
      if (!response.ok) throw new Error(`greybox load failed: HTTP ${response.status}`);
      const map = loadGameplayMap(await response.arrayBuffer());
      world = new CollisionWorld(map.collision, map.killVolumes);
      const spawn = map.spawns[0];
      state = createInitialState();
      if (spawn !== undefined) {
        state = {
          ...state,
          player: {
            ...state.player,
            position: { ...spawn.position },
            viewYaw: (spawn.yaw * 180) / Math.PI,
          },
        };
      }
    })
    .catch((error: unknown) => {
      console.error(error);
    });

  let previous = performance.now();
  let accumulator = 0;
  const loop = (): void => {
    const now = performance.now();
    accumulator += Math.min(0.25, Math.max(0, (now - previous) / 1000));
    previous = now;
    let catchUpTicks = 0;
    while (accumulator >= TICK_DT && catchUpTicks < 4) {
      tick();
      accumulator -= TICK_DT;
      catchUpTicks += 1;
    }
    if (catchUpTicks === 4 && accumulator >= TICK_DT) accumulator = 0;
    setTimeout(loop, 4);
  };
  setTimeout(loop, 0);

  return { sim };
}
