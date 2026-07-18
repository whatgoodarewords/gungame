/** Fable-owned default, consumed by the simulation's jump-buffer hook. */
export const DEFAULT_JUMP_BUFFER_MS = 80 as const;
export const DEFAULT_DUCK_TRANSITION_MS = 400 as const;
export const DEFAULT_DUCK_SPEED_SCALE = 0.333 as const;
export const DEFAULT_FEET_TUCK = 0.45 as const;
export const DEFAULT_COYOTE_MS = 50 as const;
export const DEFAULT_CORNER_NUDGE = 0.05 as const;
export const DEFAULT_SLIDE_FRICTION_SCALE = 0.25 as const;
export const DEFAULT_SLIDE_MS = 300 as const;

export interface FeelParams {
  readonly jumpBufferMs: number;
  /** Optional only for the Phase 1 client's legacy jump-buffer-only setter. */
  readonly duckTransitionMs?: number;
  readonly duckSpeedScale?: number;
  readonly feetTuck?: number;
  readonly coyoteMs?: number;
  readonly cornerNudge?: number;
  readonly slideFrictionScale?: number;
  readonly slideMs?: number;
}

export type ResolvedFeelParams = Required<FeelParams>;

export const DEFAULT_FEEL: ResolvedFeelParams = Object.freeze({
  jumpBufferMs: DEFAULT_JUMP_BUFFER_MS,
  duckTransitionMs: DEFAULT_DUCK_TRANSITION_MS,
  duckSpeedScale: DEFAULT_DUCK_SPEED_SCALE,
  feetTuck: DEFAULT_FEET_TUCK,
  coyoteMs: DEFAULT_COYOTE_MS,
  cornerNudge: DEFAULT_CORNER_NUDGE,
  slideFrictionScale: DEFAULT_SLIDE_FRICTION_SCALE,
  slideMs: DEFAULT_SLIDE_MS,
});
