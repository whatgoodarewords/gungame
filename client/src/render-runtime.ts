export interface RenderPipelineLike {
  render(): void;
  dispose(): void;
  handleAsyncError?(error: unknown): boolean;
}

export interface RenderFallbackStage {
  readonly label: string;
  readonly create: () => RenderPipelineLike;
}

/**
 * A renderer pipeline with progressively simpler stages. Synchronous graph
 * construction/render errors advance immediately; asynchronously reported GPU
 * validation failures advance before the next frame.
 */
export class FallbackRenderPipeline implements RenderPipelineLike {
  private active: RenderPipelineLike | undefined;
  private stageIndex = 0;
  private lastRenderedStageIndex = -1;
  private disposed = false;
  private readonly stages: readonly RenderFallbackStage[];
  private readonly reportError: (label: string, error: unknown) => void;
  private readonly onFallback: (
    failedLabel: string,
    nextLabel: string,
    error: unknown,
  ) => void;

  constructor(
    stages: readonly RenderFallbackStage[],
    reportError: (label: string, error: unknown) => void = (label, error) =>
      console.error(`render stage failed (${label})`, error),
    onFallback: (
      failedLabel: string,
      nextLabel: string,
      error: unknown,
    ) => void = () => {},
  ) {
    if (stages.length === 0) throw new Error("render fallback chain requires at least one stage");
    this.stages = stages;
    this.reportError = reportError;
    this.onFallback = onFallback;
  }

  get activeLabel(): string {
    return this.stages[Math.min(this.stageIndex, this.stages.length - 1)]!.label;
  }

  render(): void {
    if (this.disposed) throw new Error("cannot render a disposed fallback pipeline");
    for (;;) {
      try {
        this.active ??= this.stages[this.stageIndex]!.create();
        this.active.render();
        this.lastRenderedStageIndex = this.stageIndex;
        return;
      } catch (error) {
        if (!this.advance(error)) throw error;
      }
    }
  }

  handleAsyncError(error: unknown): boolean {
    if (this.disposed) return false;
    // A single WebGPU frame can report several validation messages for the
    // stage that just failed. Do not let those stale messages skip a fallback
    // stage that has not rendered yet.
    if (this.lastRenderedStageIndex !== this.stageIndex) return true;
    return this.advance(error);
  }

  private advance(error: unknown): boolean {
    const failed = this.stages[this.stageIndex]!;
    this.reportError(failed.label, error);
    if (this.stageIndex + 1 >= this.stages.length) return false;
    this.active?.dispose();
    this.active = undefined;
    this.stageIndex += 1;
    this.onFallback(failed.label, this.stages[this.stageIndex]!.label, error);
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.active?.dispose();
    this.active = undefined;
    this.disposed = true;
  }
}

interface PendingPipeline {
  readonly previous: RenderPipelineLike;
  readonly candidate: RenderPipelineLike;
  readonly commit: () => void;
  readonly rollback: () => void;
}

/**
 * A style switch is not committed until its newly constructed pipeline renders
 * one frame. A graph/build failure restores the still-live previous pipeline.
 */
export class RecoverableRenderPipeline {
  private active: RenderPipelineLike;
  private pending: PendingPipeline | undefined;
  private readonly reportError: (error: unknown) => void;

  constructor(initial: RenderPipelineLike, reportError: (error: unknown) => void = console.error) {
    this.active = initial;
    this.reportError = reportError;
  }

  replace(candidate: RenderPipelineLike, commit: () => void, rollback: () => void): void {
    this.cancelPending();
    this.pending = { previous: this.active, candidate, commit, rollback };
    this.active = candidate;
  }

  cancelPending(): void {
    if (this.pending === undefined) return;
    this.pending.candidate.dispose();
    this.pending.rollback();
    this.active = this.pending.previous;
    this.pending = undefined;
  }

  render(): boolean {
    try {
      this.active.render();
    } catch (error) {
      const pending = this.pending;
      this.reportError(error);
      if (pending === undefined) throw error;
      pending.candidate.dispose();
      pending.rollback();
      this.active = pending.previous;
      this.pending = undefined;
      this.active.render();
      return false;
    }
    if (this.pending !== undefined) {
      this.pending.previous.dispose();
      this.pending.commit();
      this.pending = undefined;
    }
    return true;
  }

  reportAsyncFailure(error: unknown): boolean {
    const target = this.pending?.candidate ?? this.active;
    if (target.handleAsyncError?.(error) === true) return true;
    this.reportError(error);
    return false;
  }

  dispose(): void {
    this.pending?.previous.dispose();
    this.active.dispose();
    this.pending = undefined;
  }
}

const WEBGPU_PIPELINE_ERROR =
  /WebGPURenderer: (?:Async )?Render pipeline creation failed/;

/**
 * three.js reports captured WebGPU pipeline-validation errors asynchronously
 * through console.error instead of throwing from render(). Bridge only that
 * failure class back into the recovery state machine while preserving the
 * original console output and arguments.
 */
export function bridgeWebGpuPipelineErrors(
  onPipelineError: (error: Error) => void,
  consoleLike: Pick<Console, "error"> = console,
): () => void {
  const original = consoleLike.error.bind(consoleLike);
  let handling = false;
  consoleLike.error = (...args: unknown[]): void => {
    original(...args);
    if (handling) return;
    const message = args.map((value) =>
      value instanceof Error ? `${value.name}: ${value.message}` : String(value)).join(" ");
    if (!WEBGPU_PIPELINE_ERROR.test(message)) return;
    handling = true;
    try {
      onPipelineError(new Error(message));
    } finally {
      handling = false;
    }
  };
  return () => {
    consoleLike.error = original;
  };
}

export type AnimationLoopSetter = (callback: (() => void) | null) => unknown;

/** Re-arms the renderer after any uncaught frame failure. */
export function armRecoverableAnimationLoop(
  setLoop: AnimationLoopSetter,
  frame: () => void,
  reportError: (error: unknown) => void = console.error,
  schedule: (callback: () => void) => void = (callback) => setTimeout(callback, 0),
): () => void {
  const guarded = (): void => {
    try {
      frame();
    } catch (error) {
      reportError(error);
      schedule(() => {
        void setLoop(guarded);
      });
    }
  };
  void setLoop(guarded);
  return guarded;
}
