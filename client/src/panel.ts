// Phase 1 dev panel: live movement params, feel dials, speed readout, draw calls.
// Plain DOM, zero deps. This panel is a tuning instrument, not product UI.

import {
  bindingLabel,
  formatButtonBits,
  type ControlAction,
  type ControlBindings,
  type InputInspectorSnapshot,
} from "./input.js";
import type { FrameBreakdown } from "./perf.js";
import type { UserSettings } from "./settings.js";

export interface PanelBindings {
  params: Record<string, number>;
  onParamChange: (key: string, value: number) => void;
  presets: Record<string, Record<string, number>>;
  onPreset: (name: string) => void;
  onSensitivity: (cm360: number, dpi: number) => void;
  styles: readonly string[];
  activeStyle: string;
  onStyle: (style: string) => void;
  controls: ControlBindings;
  onControl: (action: ControlAction, code: string) => void;
  inputInspector: () => InputInspectorSnapshot;
  settings: UserSettings;
  onSettings: (settings: UserSettings) => void;
}

export class DevPanel {
  private drawEl: HTMLElement;
  private fpsEl: HTMLElement;
  private inputBitsEl: HTMLElement;
  private inputLockEl: HTMLElement;
  private inputEventsEl: HTMLElement;
  private perfEl: HTMLElement;
  private inputs = new Map<string, HTMLInputElement>();
  private readonly inputInspector: () => InputInspectorSnapshot;

  constructor(bind: PanelBindings) {
    let settings = bind.settings;
    let controls = bind.controls;
    this.inputInspector = bind.inputInspector;
    const toggle = document.createElement("button");
    toggle.id = "settings-toggle";
    toggle.type = "button";
    toggle.textContent = "settings";
    const root = document.createElement("div");
    root.id = "devpanel";
    root.innerHTML = `<style>
      #devpanel{position:fixed;top:12px;right:12px;width:250px;background:rgba(10,12,16,.88);
        color:#cfe3cf;font:12px/1.5 ui-monospace,monospace;padding:12px;border-radius:8px;
        border:1px solid #2a3a2a;z-index:40;user-select:none;max-height:calc(100vh - 64px);overflow:auto}
      #settings-toggle{position:fixed;top:12px;right:12px;z-index:41;padding:7px 10px;color:#cfe3cf;
        background:rgba(10,12,16,.88);border:1px solid #2a3a2a;font:12px ui-monospace,monospace;cursor:pointer}
      #devpanel[hidden]{display:none}
      #devpanel h3{margin:0 0 6px;font-size:11px;letter-spacing:.14em;color:#7fae7f}
      #devpanel .row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:2px 0}
      #devpanel input[type=range]{width:120px;accent-color:#7fae7f}
      #devpanel .val{width:44px;text-align:right;color:#e8f4e8}
      #devpanel .stat{font-size:16px;color:#e8f4e8}
      #devpanel button{background:#1c2820;color:#cfe3cf;border:1px solid #2a3a2a;border-radius:4px;
        padding:2px 10px;cursor:pointer;font:inherit}
      #devpanel button:hover{border-color:#7fae7f}
      #devpanel .presets{display:flex;gap:6px;margin:4px 0 8px}
      #devpanel .control{width:126px;text-align:left}
      #devpanel select{max-width:126px;background:#1c2820;color:#cfe3cf;border:1px solid #2a3a2a}
      #devpanel .input-bits{font-size:10px;color:#e8f4e8;text-align:right}
      #devpanel .input-events{margin:3px 0 0;padding:0;list-style:none;color:#9db39d;font-size:10px}
      #devpanel .input-events li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #devpanel .perf-breakdown{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
        gap:1px 8px;font-size:10px;color:#9db39d}
      #devpanel .perf-breakdown span{display:flex;justify-content:space-between;gap:4px}
      #devpanel .perf-breakdown b{font-weight:400;color:#e8f4e8}
    </style>
    <h3>diagnostics</h3><div class="row"><span id="gg-fps">0</span><span>fps</span>
      <span id="gg-draws">0</span><span>draws</span></div>
    <div class="perf-breakdown" id="gg-perf-breakdown">
      <span>frame <b data-perf="frame">0.00</b></span>
      <span>render <b data-perf="render">0.00</b></span>
      <span>light <b data-perf="lighting">0.00</b></span>
      <span>post <b data-perf="post">0.00</b></span>
      <span>fx <b data-perf="particles">0.00</b></span>
      <span>chars <b data-perf="characters">0.00</b></span>
    </div>
    <h3 style="margin-top:10px">movement</h3>
    <div class="presets" id="gg-presets"></div>
    <div id="gg-params"></div>
    <h3 style="margin-top:10px">render style</h3>
    <div class="row"><select id="gg-style"></select></div>
    <h3 style="margin-top:10px">controls</h3>
    <div id="gg-controls"></div>
    <h3 style="margin-top:10px">input inspector</h3>
    <div class="row"><span>bits</span><code class="input-bits" id="gg-input-bits"></code></div>
    <div class="row"><span>pointer</span><span id="gg-input-lock"></span></div>
    <ol class="input-events" id="gg-input-events"></ol>
    <h3 style="margin-top:10px">input tuning</h3>
    <div class="row"><span>cm/360</span><input type="range" id="gg-cm" min="10" max="80" step="1" value="30"><span class="val" id="gg-cmv">30</span></div>
    <div class="row"><span>dpi</span><input type="range" id="gg-dpi" min="400" max="3200" step="100" value="800"><span class="val" id="gg-dpiv">800</span></div>
    <div class="row"><span>fov</span><input type="range" id="gg-fov" min="90" max="120" step="1"><span class="val" id="gg-fovv"></span></div>
    <h3 style="margin-top:10px">crosshair</h3>
    <div class="row"><span>size</span><input type="range" id="gg-cross-size" min="3" max="14" step="1"><span class="val"></span></div>
    <div class="row"><span>gap</span><input type="range" id="gg-cross-gap" min="0" max="16" step="1"><span class="val"></span></div>
    <div class="row"><span>center dot</span><input type="checkbox" id="gg-cross-dot"></div>
    <div class="row"><span>color</span><select id="gg-cross-color"><option>white</option><option>cyan</option><option>green</option><option>amber</option></select></div>
    <h3 style="margin-top:10px">audio</h3>
    <div class="row"><span>master</span><input type="range" id="gg-volume" min="0" max="1" step="0.05"><span class="val"></span></div>
    <div class="row"><span>mute</span><input type="checkbox" id="gg-mute"></div>`;
    document.body.appendChild(toggle);
    document.body.appendChild(root);
    const storageKey = "gg:dev-panel-open";
    root.hidden = localStorage.getItem(storageKey) !== "1";
    toggle.onclick = () => {
      root.hidden = !root.hidden;
      localStorage.setItem(storageKey, root.hidden ? "0" : "1");
    };
    document.addEventListener("keydown", (event) => {
      if (event.code !== "Backquote" || event.repeat) return;
      root.hidden = !root.hidden;
      localStorage.setItem(storageKey, root.hidden ? "0" : "1");
      event.preventDefault();
    });

    this.drawEl = root.querySelector("#gg-draws")!;
    this.fpsEl = root.querySelector("#gg-fps")!;
    this.inputBitsEl = root.querySelector("#gg-input-bits")!;
    this.inputLockEl = root.querySelector("#gg-input-lock")!;
    this.inputEventsEl = root.querySelector("#gg-input-events")!;
    this.perfEl = root.querySelector("#gg-perf-breakdown")!;

    const style = root.querySelector<HTMLSelectElement>("#gg-style")!;
    for (const id of bind.styles) style.add(new Option(id, id));
    style.value = bind.activeStyle;
    style.onchange = () => bind.onStyle(style.value);

    const presets = root.querySelector("#gg-presets")!;
    for (const name of Object.keys(bind.presets)) {
      const b = document.createElement("button");
      b.textContent = name;
      b.onclick = () => {
        bind.onPreset(name);
        for (const [k, v] of Object.entries(bind.presets[name] ?? {})) this.setParam(k, v);
      };
      presets.appendChild(b);
    }

    const paramsEl = root.querySelector("#gg-params")!;
    const ranges: Record<string, [number, number, number]> = {
      gravity: [1, 40, 0.5],
      runSpeed: [2, 12, 0.1],
      airAccelerate: [0, 20, 0.5],
      groundAccelerate: [1, 20, 0.5],
      friction: [0, 12, 0.5],
      jumpVelocity: [2, 10, 0.1],
      jumpBufferMs: [0, 200, 5],
    };
    for (const [key, val] of Object.entries(bind.params)) {
      const [min, max, step] = ranges[key] ?? [0, val * 3 || 10, 0.1];
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span>${key}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}"><span class="val">${val}</span>`;
      const input = row.querySelector("input")!;
      const valEl = row.querySelector(".val")!;
      input.oninput = () => {
        valEl.textContent = input.value;
        bind.onParamChange(key, Number(input.value));
      };
      this.inputs.set(key, input);
      paramsEl.appendChild(row);
    }

    const cm = root.querySelector<HTMLInputElement>("#gg-cm")!;
    const dpi = root.querySelector<HTMLInputElement>("#gg-dpi")!;
    const sync = () => {
      root.querySelector("#gg-cmv")!.textContent = cm.value;
      root.querySelector("#gg-dpiv")!.textContent = dpi.value;
      bind.onSensitivity(Number(cm.value), Number(dpi.value));
    };
    cm.oninput = sync;
    dpi.oninput = sync;

    const controlsRoot = root.querySelector<HTMLElement>("#gg-controls")!;
    const actions: readonly ControlAction[] = [
      "forward", "back", "left", "right", "jump", "duck", "melee",
    ];
    const renderControls = (): void => {
      controlsRoot.replaceChildren();
      for (const action of actions) {
        const row = document.createElement("div");
        row.className = "row";
        const label = document.createElement("span");
        label.textContent = action;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "control";
        button.textContent = controls[action].map(bindingLabel).join(" / ");
        button.onclick = () => {
          button.textContent = "press a key";
          const capture = (event: KeyboardEvent): void => {
            event.preventDefault();
            if (event.code === "Escape" || event.metaKey ||
              (event.ctrlKey && !event.code.startsWith("Control"))) {
              renderControls();
              return;
            }
            bind.onControl(action, event.code);
            controls = {
              ...controls,
              [action]: [event.code, ...controls[action].slice(1)],
            };
            renderControls();
          };
          document.addEventListener("keydown", capture, { once: true, capture: true });
        };
        row.append(label, button);
        controlsRoot.appendChild(row);
      }
    };
    renderControls();

    const fov = root.querySelector<HTMLInputElement>("#gg-fov")!;
    const size = root.querySelector<HTMLInputElement>("#gg-cross-size")!;
    const gap = root.querySelector<HTMLInputElement>("#gg-cross-gap")!;
    const dot = root.querySelector<HTMLInputElement>("#gg-cross-dot")!;
    const color = root.querySelector<HTMLSelectElement>("#gg-cross-color")!;
    const volume = root.querySelector<HTMLInputElement>("#gg-volume")!;
    const mute = root.querySelector<HTMLInputElement>("#gg-mute")!;
    fov.value = String(settings.fov);
    size.value = String(settings.crosshair.size);
    gap.value = String(settings.crosshair.gap);
    dot.checked = settings.crosshair.dot;
    color.value = settings.crosshair.color;
    volume.value = String(settings.masterVolume);
    mute.checked = settings.muted;
    const emitSettings = (): void => {
      settings = {
        fov: Number(fov.value),
        masterVolume: Number(volume.value),
        muted: mute.checked,
        crosshair: {
          size: Number(size.value),
          gap: Number(gap.value),
          dot: dot.checked,
          color: color.value as UserSettings["crosshair"]["color"],
        },
      };
      root.querySelector("#gg-fovv")!.textContent = fov.value;
      (size.nextElementSibling as HTMLElement).textContent = size.value;
      (gap.nextElementSibling as HTMLElement).textContent = gap.value;
      (volume.nextElementSibling as HTMLElement).textContent =
        `${Math.round(Number(volume.value) * 100)}%`;
      bind.onSettings(settings);
    };
    for (const input of [fov, size, gap, dot, color, volume, mute]) {
      input.addEventListener("input", emitSettings);
    }
    emitSettings();
  }

  private setParam(key: string, value: number): void {
    const input = this.inputs.get(key);
    if (!input) return;
    input.value = String(value);
    (input.nextElementSibling as HTMLElement).textContent = String(value);
  }

  update(fps: number, drawCalls: number, breakdown: FrameBreakdown): void {
    this.fpsEl.textContent = String(Math.round(fps));
    this.drawEl.textContent = String(drawCalls);
    for (const key of [
      "frame", "render", "lighting", "post", "particles", "characters",
    ] as const) {
      const value = this.perfEl.querySelector<HTMLElement>(`[data-perf="${key}"]`);
      if (value !== null) value.textContent = `${breakdown[key].toFixed(2)} ms`;
    }
    const input = this.inputInspector();
    this.inputBitsEl.textContent = formatButtonBits(input.buttons);
    this.inputLockEl.textContent = input.locked ? "locked" : "unlocked";
    this.inputEventsEl.replaceChildren(...input.keyEvents.map((event) => {
      const item = document.createElement("li");
      item.textContent = `${event.phase === "down" ? "↓" : "↑"} ${bindingLabel(event.code)}${event.repeat ? " · repeat" : ""}`;
      return item;
    }));
  }
}
