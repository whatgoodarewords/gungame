/** Fable-owned default, consumed by the simulation's jump-buffer hook. */
export const DEFAULT_JUMP_BUFFER_MS = 80 as const;

export interface FeelParams {
  readonly jumpBufferMs: number;
}

export const DEFAULT_FEEL: FeelParams = Object.freeze({
  jumpBufferMs: DEFAULT_JUMP_BUFFER_MS,
});
