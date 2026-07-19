export interface RenderPipelineLike {
  render(): void;
  dispose(): void;
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

  dispose(): void {
    this.pending?.previous.dispose();
    this.active.dispose();
    this.pending = undefined;
  }
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
