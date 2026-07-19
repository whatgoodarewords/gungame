export const CLIP_WINDOW_MS = 12_000;
const WEBM_CLUSTER_ID = Uint8Array.of(0x1f, 0x43, 0xb6, 0x75);

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

function sequenceIndex(bytes: Uint8Array, sequence: Uint8Array, from = 0): number {
  outer: for (let index = Math.max(0, from); index <= bytes.length - sequence.length; index += 1) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (bytes[index + offset] !== sequence[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

function readVint(bytes: Uint8Array, offset: number): { length: number; value: number } | undefined {
  const first = bytes[offset];
  if (first === undefined || first === 0) return undefined;
  let marker = 0x80;
  let length = 1;
  while ((first & marker) === 0 && length < 8) {
    marker >>= 1;
    length += 1;
  }
  if (offset + length > bytes.length) return undefined;
  let value = first & (marker - 1);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index]!;
  }
  return { length, value };
}

function readUnsigned(bytes: Uint8Array, offset: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + bytes[offset + index]!;
  return value;
}

function writeUnsigned(bytes: Uint8Array, offset: number, length: number, value: number): void {
  let remaining = Math.max(0, Math.floor(value));
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[offset + index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
}

interface WebmTimecode {
  readonly offset: number;
  readonly length: number;
  readonly value: number;
}

function clusterTimecodes(bytes: Uint8Array): readonly WebmTimecode[] {
  const clusters: number[] = [];
  let searchAt = 0;
  for (;;) {
    const offset = sequenceIndex(bytes, WEBM_CLUSTER_ID, searchAt);
    if (offset < 0) break;
    clusters.push(offset);
    searchAt = offset + WEBM_CLUSTER_ID.length;
  }
  const timecodes: WebmTimecode[] = [];
  for (let index = 0; index < clusters.length; index += 1) {
    const clusterOffset = clusters[index]!;
    const size = readVint(bytes, clusterOffset + WEBM_CLUSTER_ID.length);
    if (size === undefined) continue;
    const payloadStart = clusterOffset + WEBM_CLUSTER_ID.length + size.length;
    const nextCluster = clusters[index + 1] ?? bytes.length;
    const declaredEnd = size.value >= 2 ** 53 - 1
      ? nextCluster
      : Math.min(nextCluster, payloadStart + size.value);
    const searchEnd = Math.min(declaredEnd, payloadStart + 64);
    for (let offset = payloadStart; offset < searchEnd; offset += 1) {
      if (bytes[offset] !== 0xe7) continue;
      const timecodeSize = readVint(bytes, offset + 1);
      if (timecodeSize === undefined || timecodeSize.value < 1 || timecodeSize.value > 6) continue;
      const valueOffset = offset + 1 + timecodeSize.length;
      if (valueOffset + timecodeSize.value > declaredEnd) continue;
      timecodes.push({
        offset: valueOffset,
        length: timecodeSize.value,
        value: readUnsigned(bytes, valueOffset, timecodeSize.value),
      });
      break;
    }
  }
  return timecodes;
}

/**
 * Builds a standalone rolling WebM segment: retain the EBML/track header from
 * the initial chunk, discard its stale clusters when outside the window, and
 * shift selected Cluster Timecodes so the first retained cluster starts at 0.
 */
export function rebaseWebmWindow(
  initialization: Uint8Array,
  recentParts: readonly Uint8Array[],
): Uint8Array {
  const headerEnd = sequenceIndex(initialization, WEBM_CLUSTER_ID);
  const header = headerEnd < 0 ? initialization : initialization.subarray(0, headerEnd);
  const recent = concatBytes(recentParts);
  const firstCluster = sequenceIndex(recent, WEBM_CLUSTER_ID);
  if (firstCluster < 0) return concatBytes([header, recent]);
  const clusters = recent.slice(firstCluster);
  const timecodes = clusterTimecodes(clusters);
  const base = timecodes[0]?.value;
  if (base !== undefined) {
    for (const timecode of timecodes) {
      writeUnsigned(clusters, timecode.offset, timecode.length, timecode.value - base);
    }
  }
  return concatBytes([header, clusters]);
}

export function requestFinalRecorderData(
  recorder: Pick<MediaRecorder, "addEventListener" | "requestData" | "state">,
): Promise<void> {
  if (recorder.state === "inactive") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("MediaRecorder final data flush timed out")),
      1_000,
    );
    recorder.addEventListener("dataavailable", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    try {
      recorder.requestData();
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
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

  async export(): Promise<boolean> {
    if (this.recorder === undefined || this.initChunk === undefined) return false;
    await requestFinalRecorderData(this.recorder);
    const recent = this.chunks.values(performance.now());
    const [initialization, ...parts] = await Promise.all([
      this.initChunk.arrayBuffer(),
      ...recent.map((part) => part.arrayBuffer()),
    ]);
    const bytes = rebaseWebmWindow(
      new Uint8Array(initialization),
      parts.map((part) => new Uint8Array(part)),
    );
    // TS 5.9 correctly models a Uint8Array as potentially backed by a
    // SharedArrayBuffer, which BlobPart does not accept. This owned copy is
    // guaranteed to have an ArrayBuffer backing.
    const blob = new Blob([new Uint8Array(bytes).buffer], { type: this.recorder.mimeType });
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
