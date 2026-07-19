export const CLIP_WINDOW_MS = 12_000;

export class RollingWindow<T> {
  private readonly entries: Array<{ at: number; value: T }> = [];
  private readonly durationMs: number;

  constructor(durationMs = CLIP_WINDOW_MS) {
    this.durationMs = durationMs;
  }

  push(at: number, value: T): void {
    this.entries.push({ at, value });
    const floor = at - this.durationMs;
    while (this.entries.length > 0 && this.entries[0]!.at < floor) this.entries.shift();
  }

  values(now: number): readonly T[] {
    const floor = now - this.durationMs;
    return this.entries.filter((entry) => entry.at >= floor).map((entry) => entry.value);
  }
}

export class ClipThat {
  private readonly composite = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly chunks = new RollingWindow<Blob>();
  private readonly feed = new RollingWindow<string>();
  private recorder: MediaRecorder | undefined;
  private initChunk: Blob | undefined;
  private drawing = false;
  private readonly source: HTMLCanvasElement;
  private readonly mapName: () => string;
  private readonly audioStream: () => MediaStream | undefined;

  constructor(
    source: HTMLCanvasElement,
    mapName: () => string,
    audioStream: () => MediaStream | undefined,
  ) {
    this.source = source;
    this.mapName = mapName;
    this.audioStream = audioStream;
    const context = this.composite.getContext("2d", { alpha: false });
    if (context === null) throw new Error("clip compositor unavailable");
    this.context = context;
  }

  start(): boolean {
    if (this.recorder !== undefined || typeof MediaRecorder === "undefined") return false;
    const size = this.captureSize();
    this.composite.width = size.width;
    this.composite.height = size.height;
    const video = this.composite.captureStream(60);
    const audioTrack = this.audioStream()?.getAudioTracks()[0];
    const stream = new MediaStream([
      ...video.getVideoTracks(),
      ...(audioTrack === undefined ? [] : [audioTrack]),
    ]);
    const preferred = "video/webm;codecs=vp9,opus";
    const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : "video/webm";
    this.recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 128_000,
    });
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size === 0) return;
      this.initChunk ??= event.data;
      this.chunks.push(performance.now(), event.data);
    });
    this.recorder.start(500);
    this.drawing = true;
    this.draw();
    return true;
  }

  recordKillfeed(line: string): void {
    this.feed.push(performance.now(), line.toLowerCase());
  }

  export(): boolean {
    if (this.recorder === undefined || this.initChunk === undefined) return false;
    this.recorder.requestData();
    const recent = this.chunks.values(performance.now());
    const parts = recent[0] === this.initChunk ? recent : [this.initChunk, ...recent];
    const blob = new Blob([...parts], { type: this.recorder.mimeType });
    if (blob.size === 0) return false;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gungame-${this.mapName().toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  }

  private captureSize(): { width: number; height: number } {
    const scale = Math.min(1, 1_920 / Math.max(1, this.source.width), 1_080 / Math.max(1, this.source.height));
    return {
      width: Math.max(2, Math.floor(this.source.width * scale / 2) * 2),
      height: Math.max(2, Math.floor(this.source.height * scale / 2) * 2),
    };
  }

  private draw = (): void => {
    if (!this.drawing) return;
    const { width, height } = this.composite;
    this.context.drawImage(this.source, 0, 0, width, height);
    const pad = Math.max(18, Math.round(height * 0.028));
    this.context.save();
    this.context.textBaseline = "bottom";
    this.context.shadowColor = "rgba(0,0,0,.75)";
    this.context.shadowBlur = 6;
    this.context.fillStyle = "rgba(255,255,255,.92)";
    this.context.font = `700 ${Math.max(14, Math.round(height * 0.022))}px ui-monospace, monospace`;
    this.context.fillText(`gungame · ${this.mapName().toLowerCase()}`, pad, height - pad);
    const lines = this.feed.values(performance.now()).slice(-5);
    this.context.font = `600 ${Math.max(12, Math.round(height * 0.018))}px ui-monospace, monospace`;
    lines.forEach((line, index) => {
      const metrics = this.context.measureText(line);
      this.context.fillText(
        line,
        width - pad - metrics.width,
        height - pad - (lines.length - 1 - index) * Math.max(18, height * 0.026),
      );
    });
    this.context.restore();
    requestAnimationFrame(this.draw);
  };
}
