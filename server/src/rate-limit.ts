export class ConnectionRateLimit {
  private windowStartedMs: number;
  private messages = 0;
  private bytes = 0;
  private readonly maxMessagesPerSecond: number;
  private readonly maxBytesPerSecond: number;

  constructor(
    nowMs: number,
    maxMessagesPerSecond = 256,
    maxBytesPerSecond = 64_000,
  ) {
    this.windowStartedMs = nowMs;
    this.maxMessagesPerSecond = maxMessagesPerSecond;
    this.maxBytesPerSecond = maxBytesPerSecond;
  }

  accept(byteLength: number, nowMs: number): boolean {
    if (!Number.isInteger(byteLength) || byteLength < 0 || !Number.isFinite(nowMs)) return false;
    if (nowMs < this.windowStartedMs) return false;
    if (nowMs - this.windowStartedMs >= 1_000) {
      this.windowStartedMs = nowMs;
      this.messages = 0;
      this.bytes = 0;
    }
    this.messages += 1;
    this.bytes += byteLength;
    return this.messages <= this.maxMessagesPerSecond && this.bytes <= this.maxBytesPerSecond;
  }
}
