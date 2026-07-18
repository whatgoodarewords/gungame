export type SendPolicy = "reliable" | "latest";

export interface NetChannel {
  readonly ready: boolean;
  readonly bufferedBytes: number;
  send(payload: Uint8Array, policy: SendPolicy): void;
  close(code?: number, reason?: string): void;
}

export interface ChannelHandlers {
  readonly open: () => void;
  readonly message: (payload: Uint8Array) => void;
  readonly close: (code: number, reason: string) => void;
  readonly error: () => void;
}

export class WebSocketNetChannel implements NetChannel {
  private readonly socket: WebSocket;
  private pendingLatest: Uint8Array | undefined;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(url: string, handlers: ChannelHandlers) {
    this.socket = new WebSocket(url);
    this.socket.binaryType = "arraybuffer";
    this.socket.addEventListener("open", handlers.open);
    this.socket.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
      handlers.message(new Uint8Array(event.data));
    });
    this.socket.addEventListener("close", (event) => handlers.close(event.code, event.reason));
    this.socket.addEventListener("error", handlers.error);
  }

  get ready(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  get bufferedBytes(): number {
    return this.socket.bufferedAmount;
  }

  send(payload: Uint8Array, policy: SendPolicy): void {
    if (!this.ready) return;
    if (policy === "reliable" || this.socket.bufferedAmount < 32 * 1_024) {
      this.socket.send(payload);
      return;
    }
    this.pendingLatest = payload.slice();
    this.scheduleFlush();
  }

  close(code = 1_000, reason = ""): void {
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer);
    this.socket.close(code, reason);
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return;
    const flush = (): void => {
      this.flushTimer = undefined;
      if (!this.ready || this.pendingLatest === undefined) return;
      if (this.socket.bufferedAmount >= 8 * 1_024) {
        this.scheduleFlush();
        return;
      }
      const payload = this.pendingLatest;
      this.pendingLatest = undefined;
      this.socket.send(payload);
    };
    this.flushTimer = setTimeout(flush, 4);
  }
}
