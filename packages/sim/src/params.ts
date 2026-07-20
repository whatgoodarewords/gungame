export interface MoveParams {
  readonly gravity: number;
  readonly runSpeed: number;
  readonly airAccelerate: number;
  readonly groundAccelerate: number;
  readonly friction: number;
  /**
   * Q3 pm_stopspeed (2.5 m/s at our scale): friction's control value is
   * clamped to at least this, making deceleration linear instead of
   * asymptotic below it — the crisp "plant" on stopping. Without it, stops
   * decay exponentially and read mushy/heavy at identical top speed.
   */
  readonly stopSpeed: number;
  readonly jumpVelocity: number;
}

export const DEFAULT: MoveParams = Object.freeze({
  gravity: 20,
  runSpeed: 6.4,
  airAccelerate: 1,
  groundAccelerate: 10,
  friction: 6,
  stopSpeed: 2.5,
  jumpVelocity: 5.3,
});

export const SCOUTZ: MoveParams = Object.freeze({
  gravity: 5.5,
  runSpeed: 6.4,
  airAccelerate: 12,
  groundAccelerate: 10,
  friction: 6,
  stopSpeed: 2.5,
  jumpVelocity: 5.3,
});
