// §3.6 input truth: Pointer Lock with raw motion, cm/360 sensitivity,
// zero smoothing, view sampled per render frame, sim consumes per tick.

export interface FrameInput {
  yaw: number; // radians, absolute
  pitch: number; // radians, clamped ±89°
  buttons: number;
  /** 0..255 sub-tick position of the newest fire press inside the current tick, or -1 */
  fireFraction: number;
  /** yaw/pitch latched at the click sample, valid when fireFraction >= 0 */
  firedYaw: number;
  firedPitch: number;
}

export const Button = {
  Forward: 1 << 0,
  Back: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Jump: 1 << 4,
  Fire: 1 << 5,
  Zoom: 1 << 6,
} as const;

const PITCH_LIMIT = (89 * Math.PI) / 180;
const KEY_BUTTON: Record<string, number> = {
  KeyW: Button.Forward,
  KeyS: Button.Back,
  KeyA: Button.Left,
  KeyD: Button.Right,
  Space: Button.Jump,
};

export class RawInput {
  yaw = 0;
  pitch = 0;
  private buttons = 0;
  private fireFraction = -1;
  private firedYaw = 0;
  private firedPitch = 0;
  private radPerCount: number;
  private tickStartMs = 0;
  private tickMs: number;
  private locked = false;

  private el: HTMLElement;

  /**
   * @param cm360 centimeters of mouse travel per full turn (the competitive standard)
   * @param dpi   mouse counts per inch
   */
  constructor(el: HTMLElement, cm360 = 30, dpi = 800, tickRate = 64) {
    this.el = el;
    this.radPerCount = RawInput.radPerCount(cm360, dpi);
    this.tickMs = 1000 / tickRate;
    el.addEventListener("click", () => this.requestLock());
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) this.buttons = 0;
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      // movementX/Y are raw counts under unadjustedMovement — no OS accel.
      this.yaw -= e.movementX * this.radPerCount;
      this.pitch -= e.movementY * this.radPerCount;
      if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
      if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
    });
    document.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.buttons |= Button.Fire;
        // Latch the click sample for sub-tick reconstruction (§3.2 fire contract).
        const frac = (performance.now() - this.tickStartMs) / this.tickMs;
        this.fireFraction = Math.max(0, Math.min(255, Math.floor(frac * 256)));
        this.firedYaw = this.yaw;
        this.firedPitch = this.pitch;
      }
      if (e.button === 2) this.buttons |= Button.Zoom;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.buttons &= ~Button.Fire;
      if (e.button === 2) this.buttons &= ~Button.Zoom;
    });
    document.addEventListener("keydown", (e) => {
      const b = KEY_BUTTON[e.code];
      if (b !== undefined && this.locked) {
        this.buttons |= b;
        e.preventDefault();
      }
    });
    document.addEventListener("keyup", (e) => {
      const b = KEY_BUTTON[e.code];
      if (b !== undefined) this.buttons &= ~b;
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  static radPerCount(cm360: number, dpi: number): number {
    const countsPer360 = (cm360 / 2.54) * dpi;
    return (2 * Math.PI) / countsPer360;
  }

  setSensitivity(cm360: number, dpi = 800): void {
    this.radPerCount = RawInput.radPerCount(cm360, dpi);
  }

  private requestLock(): void {
    // unadjustedMovement gives raw counts; fall back where unsupported.
    const p = this.el.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions);
    if (p && typeof (p as Promise<void>).catch === "function") {
      (p as Promise<void>).catch(() => this.el.requestPointerLock());
    }
  }

  /** Called by the fixed-tick loop at each tick boundary; returns and re-arms per-tick state. */
  sampleTick(): FrameInput {
    const out: FrameInput = {
      yaw: this.yaw,
      pitch: this.pitch,
      buttons: this.buttons,
      fireFraction: this.fireFraction,
      firedYaw: this.firedYaw,
      firedPitch: this.firedPitch,
    };
    this.fireFraction = -1;
    this.tickStartMs = performance.now();
    return out;
  }

  get isLocked(): boolean {
    return this.locked;
  }
}
