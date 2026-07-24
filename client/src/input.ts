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

export interface InputKeyEvent {
  readonly code: string;
  readonly phase: "down" | "up";
  readonly repeat: boolean;
}

export interface InputInspectorSnapshot {
  readonly buttons: number;
  readonly locked: boolean;
  readonly keyEvents: readonly InputKeyEvent[];
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
  | "melee"
  | "clip";

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
  clip: Object.freeze(["F8"]),
});

const ACTION_BUTTON: Readonly<Record<ControlAction, number>> = Object.freeze({
  forward: Button.Forward,
  back: Button.Back,
  left: Button.Left,
  right: Button.Right,
  jump: Button.Jump,
  duck: Button.Duck,
  melee: Button.Melee,
  clip: 0,
});

const BUTTON_NAMES = Object.freeze([
  [Button.Forward, "forward"],
  [Button.Back, "back"],
  [Button.Left, "left"],
  [Button.Right, "right"],
  [Button.Jump, "jump"],
  [Button.Fire, "fire"],
  [Button.Duck, "duck"],
  [Button.Zoom, "zoom"],
  [Button.Background, "background"],
  [Button.Melee, "melee"],
] as const);

const CONTROL_ACTIONS = Object.keys(DEFAULT_CONTROL_BINDINGS) as ControlAction[];

function safeBindingCode(value: unknown): value is string {
  return typeof value === "string" && /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight|Tab)$/.test(value);
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

export function buttonsForPressedCodes(
  bindings: ControlBindings,
  codes: readonly string[],
): number {
  let buttons = 0;
  for (const action of CONTROL_ACTIONS) {
    if (bindings[action].some((code) => codes.includes(code))) {
      buttons |= ACTION_BUTTON[action];
    }
  }
  return buttons;
}

export function formatButtonBits(buttons: number): string {
  const active = BUTTON_NAMES
    .filter(([bit]) => (buttons & bit) !== 0)
    .map(([, name]) => name);
  return `0x${buttons.toString(16).padStart(3, "0")} · ${active.join(" ") || "none"}`;
}

const PITCH_LIMIT = (89 * Math.PI) / 180;

export function pointerAnglesAfterDelta(
  yaw: number,
  pitch: number,
  movementX: number,
  movementY: number,
  radPerCount: number,
): { readonly yaw: number; readonly pitch: number } {
  return {
    yaw: yaw - movementX * radPerCount,
    pitch: Math.max(
      -PITCH_LIMIT,
      Math.min(PITCH_LIMIT, pitch - movementY * radPerCount),
    ),
  };
}

export function resolveLiveInputElement(
  configured: HTMLElement,
  ownerDocument: Document = document,
): HTMLElement {
  if (configured.isConnected && configured.ownerDocument === ownerDocument) return configured;
  return ownerDocument.querySelector<HTMLElement>("#app canvas:last-of-type") ?? configured;
}

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
  private pendingFireEventMs = -1;
  private locked = false;
  private lockErrorRetried = false;
  /** Which event stream feeds aim ("pointerrawupdate" | "mousemove"). */
  aimSource = "mousemove";
  private queuedJump = false;
  private queuedFire = false;
  private bindings: ControlBindings;
  private keyButtons = new Map<string, number>();
  private lockListeners = new Set<(locked: boolean) => void>();
  private readonly keyEvents: InputKeyEvent[] = [];
  private activityMs = performance.now();
  private readonly resolveConfiguredElement: () => HTMLElement;

  /**
   * @param cm360 centimeters of mouse travel per full turn (the competitive standard)
   * @param dpi   mouse counts per inch
   */
  constructor(el: HTMLElement | (() => HTMLElement), cm360 = 30, dpi = 800, tickRate = 64) {
    this.resolveConfiguredElement = typeof el === "function" ? el : () => el;
    this.radPerCount = RawInput.radPerCount(cm360, dpi);
    this.tickMs = 1000 / tickRate;
    this.bindings = loadControlBindings(localStorage);
    this.rebuildKeyButtons();
    document.addEventListener("pointerdown", (event) => {
      // Any game canvas counts — the resilience ladder can swap/append
      // canvases, and an identity check against one specific node turned
      // "click to play" into a no-op when it pointed at the wrong canvas.
      const target = event.target;
      if (
        !(target instanceof HTMLCanvasElement) ||
        target.closest("#app") === null
      ) return;
      this.markActivity();
      if (event.button !== 0 || this.locked) return;
      // Preserve the gesture as an actual shot while it also acquires lock.
      this.latchFire();
      this.requestLock();
      event.preventDefault();
    }, { capture: true });
    document.addEventListener("pointerlockchange", () => {
      // Containment, not identity: the render-resilience ladder can append a
      // replacement canvas, so "the exact last-of-type canvas" may not be the
      // element that received the lock. Any locked element inside the game
      // root means the player is captured — movement events are document-level
      // and do not care which canvas holds the lock. Identity comparison here
      // left this.locked false while the pointer WAS locked: every input dead,
      // cursor gone, "stuck at spawn". (Safari/fallback-canvas race)
      const lockedElement = document.pointerLockElement;
      this.locked = lockedElement !== null &&
        (lockedElement === this.liveElement() ||
          lockedElement.closest?.("#app") !== null);
      document.querySelector<HTMLElement>("#app")?.setAttribute(
        "data-lock-state",
        this.locked ? "locked" : "unlocked",
      );
      if (!this.locked) {
        this.buttons = 0;
        this.queuedJump = false;
      }
      for (const listener of this.lockListeners) listener(this.locked);
    });
    document.addEventListener("pointerlockerror", () => {
      // Surface the failure class loudly — a silent lock error IS the
      // "mouse moves a cursor, not the view" bug report. Retry the plain
      // request at most once per gesture (the retry itself can error, and an
      // unguarded handler would loop on the event).
      console.error("pointer lock request failed (pointerlockerror)");
      document.querySelector<HTMLElement>("#app")?.setAttribute("data-lock-state", "error");
      if (!this.lockErrorRetried) {
        this.lockErrorRetried = true;
        this.requestFallbackLock();
      }
    });
    // Aim input source (native-feel §1 / F8): pointerrawupdate delivers mouse
    // deltas off the rAF-aligned coalescing path — Chromium batches mousemove
    // to frame cadence, adding up to a frame of aim latency and staling the
    // click-latched fire angles. Feature-detect; mousemove stays as the only
    // handler where rawupdate is unsupported (Safari/Firefox).
    const applyPointerDelta = (dx: number, dy: number): void => {
      const next = pointerAnglesAfterDelta(this.yaw, this.pitch, dx, dy, this.radPerCount);
      this.yaw = next.yaw;
      this.pitch = next.pitch;
    };
    const rawUpdateSupported = "onpointerrawupdate" in window;
    this.aimSource = rawUpdateSupported ? "pointerrawupdate" : "mousemove";
    if (rawUpdateSupported) {
      document.addEventListener("pointerrawupdate", (event) => {
        if (!this.locked) return;
        this.markActivity();
        const raw = event as PointerEvent;
        // Coalesced events carry the full delta trail since the last dispatch.
        const coalesced = typeof raw.getCoalescedEvents === "function"
          ? raw.getCoalescedEvents()
          : [];
        if (coalesced.length > 0) {
          for (const sample of coalesced) {
            applyPointerDelta(sample.movementX, sample.movementY);
          }
        } else {
          applyPointerDelta(raw.movementX, raw.movementY);
        }
      });
    } else {
      document.addEventListener("mousemove", (e) => {
        if (!this.locked) return;
        this.markActivity();
        // movementX/Y are raw counts under unadjustedMovement — no OS accel.
        applyPointerDelta(e.movementX, e.movementY);
      });
    }
    document.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      this.markActivity();
      if (e.button === 0) {
        this.latchFire(e.timeStamp);
      }
      if (e.button === 2) this.buttons |= Button.Zoom;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.buttons &= ~Button.Fire;
      if (e.button === 2) this.buttons &= ~Button.Zoom;
    });
    document.addEventListener("keydown", (e) => {
      this.recordKeyEvent(e.code, "down", e.repeat);
      const b = this.keyButtons.get(e.code);
      if (b !== undefined && b !== 0 && this.locked) {
        this.buttons |= b;
        this.markActivity();
        e.preventDefault();
      }
    });
    document.addEventListener("keyup", (e) => {
      this.recordKeyEvent(e.code, "up", e.repeat);
      const b = this.keyButtons.get(e.code);
      if (b !== undefined) this.buttons &= ~b;
    });
    document.addEventListener("wheel", (event) => {
      if (event.target !== this.liveElement()) return;
      if (!this.locked || event.deltaY <= 0) return;
      this.queuedJump = true;
      this.markActivity();
      event.preventDefault();
    }, { passive: false });
    document.addEventListener("contextmenu", (event) => {
      if (event.target === this.liveElement()) event.preventDefault();
    });
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

  get inspector(): InputInspectorSnapshot {
    return {
      buttons: this.buttons |
        (this.queuedJump ? Button.Jump : 0) |
        (this.queuedFire ? Button.Fire : 0),
      locked: this.locked,
      keyEvents: this.keyEvents.map((event) => ({ ...event })),
    };
  }

  onLockChange(listener: (locked: boolean) => void): () => void {
    this.lockListeners.add(listener);
    return () => this.lockListeners.delete(listener);
  }

  requestLock(): void {
    // unadjustedMovement gives raw counts; fall back where unsupported.
    this.lockErrorRetried = false;
    const element = this.liveElement();
    if (!element.isConnected || element.ownerDocument !== document) {
      console.warn("pointer lock skipped: live canvas is not mounted");
      return;
    }
    try {
      const pending = element.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions);
      if (pending && typeof (pending as Promise<void>).catch === "function") {
        void (pending as Promise<void>).catch(() => this.requestFallbackLock());
      }
    } catch {
      this.requestFallbackLock();
    }
  }

  /** Non-consuming view for render-rate readers (camera, HUD): never clears pulses. */
  peek(): FrameInput {
    return {
      yaw: this.yaw,
      pitch: this.pitch,
      buttons: this.buttons,
      fireFraction: -1,
      firedYaw: this.firedYaw,
      firedPitch: this.firedPitch,
    };
  }

  /** Called by the fixed-tick loop at each tick boundary; returns and re-arms per-tick state. */
  sampleTick(): FrameInput {
    const consumedFire = this.queuedFire;
    const pulseButtons =
      (this.queuedJump ? Button.Jump : 0) |
      (consumedFire ? Button.Fire : 0);
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

  /** Distinct key codes seen in the recent keydown ring (diagnostics). */
  recentKeyCodes(): readonly string[] {
    return [...new Set(this.keyEvents.filter((e) => e.phase === "down").map((e) => e.code))];
  }

  /** True while any movement-mapped button is currently held. */
  get anyMovementHeld(): boolean {
    return (this.buttons & (Button.Forward | Button.Back | Button.Left | Button.Right)) !== 0;
  }

  /**
   * Self-heal for corrupted/remapped stored bindings — the one failure that
   * survives every deploy and cache clear on ONE machine only: W does
   * nothing forever and no fresh-profile CI can reproduce it.
   */
  resetBindings(): void {
    localStorage.removeItem(CONTROL_BINDINGS_STORAGE_KEY);
    this.bindings = DEFAULT_CONTROL_BINDINGS;
    this.rebuildKeyButtons();
  }

  private latchFire(eventMs = -1): void {
    this.buttons |= Button.Fire;
    this.queuedFire = true;
    const frac = (performance.now() - this.tickStartMs) / this.tickMs;
    this.fireFraction = Math.max(0, Math.min(255, Math.floor(frac * 256)));
    this.firedYaw = this.yaw;
    this.firedPitch = this.pitch;
    if (eventMs >= 0 && this.pendingFireEventMs < 0) this.pendingFireEventMs = eventMs;
  }

  /**
   * Timestamp (performance.now() timebase) of the oldest un-consumed fire event,
   * or -1. Drained by the render loop to feed the click-to-photon estimator (F4).
   */
  takeFireEventMs(): number {
    const value = this.pendingFireEventMs;
    this.pendingFireEventMs = -1;
    return value;
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

  private recordKeyEvent(code: string, phase: InputKeyEvent["phase"], repeat: boolean): void {
    this.keyEvents.push({ code, phase, repeat });
    if (this.keyEvents.length > 5) this.keyEvents.shift();
  }

  private requestFallbackLock(): void {
    const fallback = this.liveElement();
    if (!fallback.isConnected || fallback.ownerDocument !== document) return;
    try {
      const pending = fallback.requestPointerLock();
      if (pending && typeof (pending as Promise<void>).catch === "function") {
        void (pending as Promise<void>).catch((error) => {
          console.warn("pointer lock request rejected", error);
        });
      }
    } catch (error) {
      console.warn("pointer lock request rejected", error);
    }
  }

  private liveElement(): HTMLElement {
    return resolveLiveInputElement(this.resolveConfiguredElement());
  }
}
