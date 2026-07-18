// Phase 1 dev panel: live movement params, feel dials, speed readout, draw calls.
// Plain DOM, zero deps. This panel is a tuning instrument, not product UI.

export interface PanelBindings {
  params: Record<string, number>;
  onParamChange: (key: string, value: number) => void;
  presets: Record<string, Record<string, number>>;
  onPreset: (name: string) => void;
  onSensitivity: (cm360: number, dpi: number) => void;
}

export class DevPanel {
  private speedEl: HTMLElement;
  private drawEl: HTMLElement;
  private fpsEl: HTMLElement;
  private inputs = new Map<string, HTMLInputElement>();

  constructor(bind: PanelBindings) {
    const root = document.createElement("div");
    root.id = "devpanel";
    root.innerHTML = `<style>
      #devpanel{position:fixed;top:12px;right:12px;width:250px;background:rgba(10,12,16,.88);
        color:#cfe3cf;font:12px/1.5 ui-monospace,monospace;padding:12px;border-radius:8px;
        border:1px solid #2a3a2a;z-index:10;user-select:none}
      #devpanel h3{margin:0 0 6px;font-size:11px;letter-spacing:.14em;color:#7fae7f}
      #devpanel .row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:2px 0}
      #devpanel input[type=range]{width:120px;accent-color:#7fae7f}
      #devpanel .val{width:44px;text-align:right;color:#e8f4e8}
      #devpanel .stat{font-size:16px;color:#e8f4e8}
      #devpanel button{background:#1c2820;color:#cfe3cf;border:1px solid #2a3a2a;border-radius:4px;
        padding:2px 10px;cursor:pointer;font:inherit}
      #devpanel button:hover{border-color:#7fae7f}
      #devpanel .presets{display:flex;gap:6px;margin:4px 0 8px}
    </style>
    <h3>SPEED</h3><div class="row"><span class="stat" id="gg-speed">0.0</span><span>m/s</span>
      <span id="gg-fps" style="margin-left:auto">0</span><span>fps</span>
      <span id="gg-draws">0</span><span>draws</span></div>
    <h3 style="margin-top:10px">MOVEMENT</h3>
    <div class="presets" id="gg-presets"></div>
    <div id="gg-params"></div>
    <h3 style="margin-top:10px">INPUT</h3>
    <div class="row"><span>cm/360</span><input type="range" id="gg-cm" min="10" max="80" step="1" value="30"><span class="val" id="gg-cmv">30</span></div>
    <div class="row"><span>DPI</span><input type="range" id="gg-dpi" min="400" max="3200" step="100" value="800"><span class="val" id="gg-dpiv">800</span></div>`;
    document.body.appendChild(root);

    this.speedEl = root.querySelector("#gg-speed")!;
    this.drawEl = root.querySelector("#gg-draws")!;
    this.fpsEl = root.querySelector("#gg-fps")!;

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
  }

  private setParam(key: string, value: number): void {
    const input = this.inputs.get(key);
    if (!input) return;
    input.value = String(value);
    (input.nextElementSibling as HTMLElement).textContent = String(value);
  }

  update(speedMs: number, fps: number, drawCalls: number): void {
    this.speedEl.textContent = speedMs.toFixed(1);
    this.fpsEl.textContent = String(Math.round(fps));
    this.drawEl.textContent = String(drawCalls);
  }
}
