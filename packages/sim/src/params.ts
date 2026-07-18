export interface MoveParams {
  readonly gravity: number;
  readonly runSpeed: number;
  readonly airAccelerate: number;
  readonly groundAccelerate: number;
  readonly friction: number;
  readonly jumpVelocity: number;
}

export const DEFAULT: MoveParams = Object.freeze({
  gravity: 20,
  runSpeed: 6.4,
  airAccelerate: 1,
  groundAccelerate: 10,
  friction: 6,
  jumpVelocity: 5.3,
});

export const SCOUTZ: MoveParams = Object.freeze({
  gravity: 5.5,
  runSpeed: 6.4,
  airAccelerate: 12,
  groundAccelerate: 10,
  friction: 6,
  jumpVelocity: 5.3,
});
