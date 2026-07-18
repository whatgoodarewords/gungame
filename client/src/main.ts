import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGPURenderer,
} from "three/webgpu";

import "./style.css";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`missing client mount point: ${selector}`);
  }

  return element;
}

const app = requiredElement<HTMLDivElement>("#app");
const fps = requiredElement<HTMLDivElement>("#fps");

const scene = new Scene();
scene.background = new Color(0x10151f);

const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(3, 2.4, 4.5);
camera.lookAt(0, 0.25, 0);

// WebGPURenderer selects its WebGL 2 backend when WebGPU is unavailable.
const renderer = new WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.append(renderer.domElement);

const cube = new Mesh(
  new BoxGeometry(1.25, 1.25, 1.25),
  new MeshStandardMaterial({ color: 0x65d4ff, metalness: 0.18, roughness: 0.34 }),
);
cube.position.y = 0.75;
scene.add(cube);

const floor = new Mesh(
  new PlaneGeometry(12, 12),
  new MeshStandardMaterial({ color: 0x202a39, roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

scene.add(new AmbientLight(0xb8c9e8, 1.1));
const keyLight = new DirectionalLight(0xffffff, 3.5);
keyLight.position.set(4, 6, 3);
scene.add(keyLight);

let frameCount = 0;
let sampleStartedAt = performance.now();

function render(now: number): void {
  cube.rotation.x = now * 0.00045;
  cube.rotation.y = now * 0.00075;

  frameCount += 1;
  const elapsed = now - sampleStartedAt;
  if (elapsed >= 500) {
    fps.textContent = `${Math.round((frameCount * 1_000) / elapsed)} fps`;
    frameCount = 0;
    sampleStartedAt = now;
  }

  renderer.render(scene, camera);
}

function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener("resize", resize);

await renderer.init();
renderer.setAnimationLoop(render);
