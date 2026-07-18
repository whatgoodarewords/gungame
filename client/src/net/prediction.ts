import { DEFAULT_FEEL, TICK_DT, type FeelParams, type Vec3 } from "@gungame/shared";
import {
  DEFAULT,
  type Cmd,
  type CollisionWorld,
  type MoveParams,
  type State,
  step,
} from "@gungame/sim";

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

export class PredictionReconciler {
  private predicted: State;
  private readonly unacked: Cmd[] = [];
  private renderError: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly world: CollisionWorld | undefined;
  private params: MoveParams = DEFAULT;
  private feel: FeelParams = DEFAULT_FEEL;

  constructor(initial: State, world?: CollisionWorld) {
    this.predicted = initial;
    this.world = world;
  }

  get state(): State {
    return this.predicted;
  }

  configure(params: MoveParams, feel: FeelParams): void {
    this.params = { ...params };
    this.feel = { ...feel };
  }

  predict(cmd: Cmd): State {
    this.unacked.push(cmd);
    this.predicted = step(
      this.predicted,
      cmd,
      TICK_DT,
      {
        ...(this.world === undefined ? {} : { world: this.world }),
        params: this.params,
        feel: this.feel,
      },
    );
    return this.predicted;
  }

  reconcile(
    authoritative: State,
    lastProcessedCmdSeq: number,
    resetRenderOffset = false,
  ): State {
    const oldPosition = this.predicted.player.position;
    while ((this.unacked[0]?.seq ?? Infinity) <= lastProcessedCmdSeq) this.unacked.shift();
    let rebuilt = authoritative;
    for (const cmd of this.unacked) {
      rebuilt = step(
        rebuilt,
        cmd,
        TICK_DT,
        {
          ...(this.world === undefined ? {} : { world: this.world }),
          params: this.params,
          feel: this.feel,
        },
      );
    }
    this.predicted = rebuilt;
    const correction = subtract(oldPosition, rebuilt.player.position);
    this.renderError = resetRenderOffset || length(correction) > 0.5
      ? { x: 0, y: 0, z: 0 }
      : {
          x: this.renderError.x + correction.x,
          y: this.renderError.y + correction.y,
          z: this.renderError.z + correction.z,
        };
    this.constrainRenderError();
    return this.predicted;
  }

  renderPosition(dtSeconds: number): Vec3 {
    const decay = Math.exp(-Math.max(0, dtSeconds) / 0.1);
    this.renderError = {
      x: this.renderError.x * decay,
      y: this.renderError.y * decay,
      z: this.renderError.z * decay,
    };
    this.constrainRenderError();
    return {
      x: this.predicted.player.position.x + this.renderError.x,
      y: this.predicted.player.position.y + this.renderError.y,
      z: this.predicted.player.position.z + this.renderError.z,
    };
  }

  resetForEpoch(authoritative: State): void {
    this.unacked.length = 0;
    this.predicted = authoritative;
    this.renderError = { x: 0, y: 0, z: 0 };
  }

  private constrainRenderError(): void {
    if (this.world === undefined) return;
    const candidate = {
      x: this.predicted.player.position.x + this.renderError.x,
      y: this.predicted.player.position.y + this.renderError.y,
      z: this.predicted.player.position.z + this.renderError.z,
    };
    if (!this.world.capsuleFits(candidate)) this.renderError = { x: 0, y: 0, z: 0 };
  }
}
