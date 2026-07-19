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
  Duck: 1 << 6, // matches sim Buttons.Duck
  Zoom: 1 << 7, // client-local until the Phase 2 wire format pins it
  Background: 1 << 8,
  Melee: 1 << 9,
} as const;

export type ControlAction =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "jump"
  | "duck"
  | "melee";

export type ControlBindings = Readonly<Record<ControlAction, readonly string[]>>;

export const CONTROL_BINDINGS_STORAGE_KEY = "gg:controls";
export const DEFAULT_CONTROL_BINDINGS: ControlBindings = Object.freeze({
  forward: Object.freeze(["KeyW"]),
  back: Object.freeze(["KeyS"]),
  left: Object.freeze(["KeyA"]),
  right: Object.freeze(["KeyD"]),
  jump: Object.freeze(["Space"]),
  // Shift is primary because macOS commonly consumes Ctrl+Space.
  duck: Object.freeze(["ShiftLeft", "KeyC", "ControlLeft"]),
  melee: Object.freeze(["KeyF"]),
});

const ACTION_BUTTON: Readonly<Record<ControlAction, number>> = Object.freeze({
  forward: Button.Forward,
  back: Button.Back,
  left: Button.Left,
  right: Button.Right,
  jump: Button.Jump,
  duck: Button.Duck,
  melee: Button.Melee,
});

const CONTROL_ACTIONS = Object.keys(DEFAULT_CONTROL_BINDINGS) as ControlAction[];

function safeBindingCode(value: unknown): value is string {
  return typeof value === "string" && /^(?:Key[A-Z]|Digit[0-9]|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight|Tab)$/.test(value);
}

export function loadControlBindings(
  storage: Pick<Storage, "getItem">,
): ControlBindings {
  const raw = storage.getItem(CONTROL_BINDINGS_STORAGE_KEY);
  if (raw === null) return DEFAULT_CONTROL_BINDINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<ControlAction, unknown>>;
    return Object.freeze(Object.fromEntries(CONTROL_ACTIONS.map((action) => {
      const values = parsed[action];
      return [
        action,
        Array.isArray(values) && values.length !== 0 && values.every(safeBindingCode)
          ? Object.freeze(values.slice(0, 3))
          : DEFAULT_CONTROL_BINDINGS[action],
      ];
    })) as Record<ControlAction, readonly string[]>);
  } catch {
    return DEFAULT_CONTROL_BINDINGS;
  }
}

export function saveControlBindings(
  storage: Pick<Storage, "setItem">,
  bindings: ControlBindings,
): void {
  storage.setItem(CONTROL_BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
}

export function rebindControl(
  bindings: ControlBindings,
  action: ControlAction,
  code: string,
): ControlBindings {
  if (!safeBindingCode(code)) return bindings;
  const displaced = bindings[action][0];
  const next = Object.fromEntries(CONTROL_ACTIONS.map((candidate) => [
    candidate,
    candidate === action
      ? [code, ...bindings[candidate].slice(1)].filter(
          (value, index, values) => values.indexOf(value) === index,
        )
      : bindings[candidate].includes(code)
        ? [
            ...(displaced === undefined ? [] : [displaced]),
            ...bindings[candidate].filter((value) => value !== code && value !== displaced),
          ]
        : bindings[candidate],
  ])) as unknown as Record<ControlAction, readonly string[]>;
  return Object.freeze(next);
}

export function bindingLabel(code: string): string {
  return code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace("ShiftLeft", "left shift")
    .replace("ShiftRight", "right shift")
    .replace("ControlLeft", "left ctrl")
    .replace("ControlRight", "right ctrl")
    .replace("Space", "space")
    .toLowerCase();
}

const PITCH_LIMIT = (89 * Math.PI) / 180;

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
  private queuedJump = false;
  private queuedFire = false;
  private bindings: ControlBindings;
  private keyButtons = new Map<string, number>();
  private lockListeners = new Set<(locked: boolean) => void>();
  private activityMs = performance.now();

  private el: HTMLElement;

  /**
   * @param cm360 centimeters of mouse travel per full turn (the competitive standard)
   * @param dpi   mouse counts per inch
   */
  constructor(el: HTMLElement, cm360 = 30, dpi = 800, tickRate = 64) {
    this.el = el;
    this.radPerCount = RawInput.radPerCount(cm360, dpi);
    this.tickMs = 1000 / tickRate;
    this.bindings = loadControlBindings(localStorage);
    this.rebuildKeyButtons();
    el.addEventListener("pointerdown", (event) => {
      this.markActivity();
      if (event.button !== 0 || this.locked) return;
      // Preserve the gesture as an actual shot while it also acquires lock.
      this.latchFire();
      this.requestLock();
      event.preventDefault();
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) {
        this.buttons = 0;
        this.queuedJump = false;
      }
      for (const listener of this.lockListeners) listener(this.locked);
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.markActivity();
      // movementX/Y are raw counts under unadjustedMovement — no OS accel.
      this.yaw -= e.movementX * this.radPerCount;
      this.pitch -= e.movementY * this.radPerCount;
      if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
      if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
    });
    document.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      this.markActivity();
      if (e.button === 0) {
        this.latchFire();
      }
      if (e.button === 2) this.buttons |= Button.Zoom;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.buttons &= ~Button.Fire;
      if (e.button === 2) this.buttons &= ~Button.Zoom;
    });
    document.addEventListener("keydown", (e) => {
      const b = this.keyButtons.get(e.code);
      if (b !== undefined && this.locked) {
        this.buttons |= b;
        this.markActivity();
        e.preventDefault();
      }
    });
    document.addEventListener("keyup", (e) => {
      const b = this.keyButtons.get(e.code);
      if (b !== undefined) this.buttons &= ~b;
    });
    el.addEventListener("wheel", (event) => {
      if (!this.locked || event.deltaY <= 0) return;
      this.queuedJump = true;
      this.markActivity();
      event.preventDefault();
    }, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.buttons |= Button.Background;
      else this.buttons &= ~Button.Background;
    });
  }

  static radPerCount(cm360: number, dpi: number): number {
    const countsPer360 = (cm360 / 2.54) * dpi;
    return (2 * Math.PI) / countsPer360;
  }

  setSensitivity(cm360: number, dpi = 800): void {
    this.radPerCount = RawInput.radPerCount(cm360, dpi);
  }

  setBindings(bindings: ControlBindings): void {
    this.bindings = bindings;
    this.rebuildKeyButtons();
    saveControlBindings(localStorage, bindings);
  }

  get controlBindings(): ControlBindings {
    return this.bindings;
  }

  get lastActivityMs(): number {
    return this.activityMs;
  }

  onLockChange(listener: (locked: boolean) => void): () => void {
    this.lockListeners.add(listener);
    return () => this.lockListeners.delete(listener);
  }

  requestLock(): void {
    // unadjustedMovement gives raw counts; fall back where unsupported.
    const p = this.el.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions);
    if (p && typeof (p as Promise<void>).catch === "function") {
      (p as Promise<void>).catch(() => this.el.requestPointerLock());
    }
  }

  /** Called by the fixed-tick loop at each tick boundary; returns and re-arms per-tick state. */
  sampleTick(): FrameInput {
    const pulseButtons =
      (this.queuedJump ? Button.Jump : 0) |
      (this.queuedFire ? Button.Fire : 0);
    const out: FrameInput = {
      yaw: this.yaw,
      pitch: this.pitch,
      buttons: this.buttons | pulseButtons,
      fireFraction: this.fireFraction,
      firedYaw: this.firedYaw,
      firedPitch: this.firedPitch,
    };
    this.fireFraction = -1;
    this.queuedJump = false;
    this.queuedFire = false;
    this.tickStartMs = performance.now();
    return out;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  private latchFire(): void {
    this.buttons |= Button.Fire;
    this.queuedFire = true;
    const frac = (performance.now() - this.tickStartMs) / this.tickMs;
    this.fireFraction = Math.max(0, Math.min(255, Math.floor(frac * 256)));
    this.firedYaw = this.yaw;
    this.firedPitch = this.pitch;
  }

  private rebuildKeyButtons(): void {
    this.keyButtons.clear();
    for (const action of CONTROL_ACTIONS) {
      for (const code of this.bindings[action]) {
        this.keyButtons.set(code, (this.keyButtons.get(code) ?? 0) | ACTION_BUTTON[action]);
      }
    }
  }

  private markActivity(): void {
    this.activityMs = performance.now();
  }
}
