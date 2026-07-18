// Phase 1 playground: greybox arena + Q3 movement + live feel tuning.
// Sim runs at 64 Hz in the bridge; rendering interpolates between ticks.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Scene,
  WebGPURenderer,
} from "three/webgpu";

import greyboxBlobUrl from "../../maps/greybox.blob?url";
import { loadGameplayMap } from "../../packages/shared/src/index.js";
import { DEFAULT, SCOUTZ } from "../../packages/sim/src/index.js";
import { FpsCamera } from "./camera.js";
import { RawInput } from "./input.js";
import { DevPanel } from "./panel.js";
import { createPlayground } from "./sim-bridge.js";
import "./style.css";

const RAD2DEG = 180 / Math.PI;

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) throw new Error("missing #app");
const canvas = document.createElement("canvas");
app.appendChild(canvas);

const scene = new Scene();
scene.background = new Color(0x0e131b);
scene.fog = new Fog(0x0e131b, 60, 160);
scene.add(new HemisphereLight(0x9db4d4, 0x2a2f26, 0.9));
const sun = new DirectionalLight(0xfff2dd, 1.6);
sun.position.set(30, 60, 20);
scene.add(sun);

// Visual level mesh straight from the same blob the sim collides against —
// in Phase 1 what you see IS the collision truth (no visual/collision drift).
void fetch(greyboxBlobUrl)
  .then(async (r) => loadGameplayMap(await r.arrayBuffer()))
  .then((map) => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(map.collision.positions, 3));
    geo.setIndex(new BufferAttribute(map.collision.indices, 1));
    geo.computeVertexNormals();
    const mesh = new Mesh(
      geo,
      new MeshStandardMaterial({ color: 0x8892a0, roughness: 0.95, flatShading: true }),
    );
    scene.add(mesh);
  });

const { sim } = createPlayground(canvas, greyboxBlobUrl);
const input = new RawInput(canvas);
const fpsCam = new FpsCamera(window.innerWidth / window.innerHeight);

const params = { ...SCOUTZ }; // scoutz feel is the point — boot straight into it
let jumpBufferMs = 80;
sim.setParams(params);

const panel = new DevPanel({
  params: { ...params, jumpBufferMs },
  onParamChange: (key, value) => {
    if (key === "jumpBufferMs") {
      jumpBufferMs = value;
      sim.setFeel({ jumpBufferMs });
      return;
    }
    (params as Record<string, number>)[key] = value;
    sim.setParams(params);
  },
  presets: {
    SCOUTZ: { ...SCOUTZ, jumpBufferMs: 80 },
    DEFAULT: { ...DEFAULT, jumpBufferMs: 80 },
  },
  onPreset: (name) => {
    Object.assign(params, name === "SCOUTZ" ? SCOUTZ : DEFAULT);
    sim.setParams(params);
  },
  onSensitivity: (cm360, dpi) => input.setSensitivity(cm360, dpi),
});

const renderer = new WebGPURenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const resize = (): void => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  fpsCam.camera.aspect = window.innerWidth / window.innerHeight;
  fpsCam.camera.updateProjectionMatrix();
};
window.addEventListener("resize", resize);
resize();

let wasGrounded = true;
let lastFrame = performance.now();
let fpsSmoothed = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dtMs = now - lastFrame;
  lastFrame = now;
  fpsSmoothed = fpsSmoothed * 0.95 + (1000 / Math.max(dtMs, 0.1)) * 0.05;

  // Feed the freshest view + buttons into the sim (sim speaks degrees).
  const f = input.sampleTick();
  sim.applyInput({
    buttons: f.buttons,
    viewYaw: f.yaw * RAD2DEG,
    viewPitch: f.pitch * RAD2DEG,
    fireFraction: f.fireFraction >= 0 ? f.fireFraction : 0,
  });

  const prev = sim.getPrevState().player;
  const curr = sim.getState().player;
  const a = sim.getAlpha();
  const px = prev.position.x + (curr.position.x - prev.position.x) * a;
  const py = prev.position.y + (curr.position.y - prev.position.y) * a;
  const pz = prev.position.z + (curr.position.z - prev.position.z) * a;

  if (curr.grounded && !wasGrounded && curr.velocity.y <= 0) fpsCam.onLand();
  wasGrounded = curr.grounded;

  // Camera angles come straight from input (radians) — never from the 64 Hz sim.
  fpsCam.update(px, py, pz, input.yaw, input.pitch, dtMs);

  const vx = curr.velocity.x;
  const vz = curr.velocity.z;
  panel.update(Math.hypot(vx, vz), fpsSmoothed, renderer.info.render.drawCalls);

  void renderer.render(scene, fpsCam.camera);
});
