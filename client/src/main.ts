// Phase 1 playground: greybox arena + Q3 movement + live feel tuning.
// Sim runs at 64 Hz in the bridge; rendering interpolates between ticks.

import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SphereGeometry,
  WebGPURenderer,
} from "three/webgpu";

import greyboxBlobUrl from "../../maps/greybox.blob?url";
import {
  ARSENAL_LADDER,
  CLASSIC_LADDER,
  WEAPONS,
  ladderWeapons,
  loadGameplayMap,
} from "../../packages/shared/src/index.js";
import {
  EntityKind,
  EventFlags,
  EventKind,
  RoundState,
} from "../../packages/protocol/src/index.js";
import { DEFAULT, SCOUTZ } from "../../packages/sim/src/index.js";
import { FpsCamera } from "./camera.js";
import { Button, RawInput } from "./input.js";
import { DevPanel } from "./panel.js";
import { createPlayground } from "./sim-bridge.js";
import "./style.css";

const RAD2DEG = 180 / Math.PI;

const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) throw new Error("missing #app");
const root = app;

function startGame(): void {
const canvas = document.createElement("canvas");
root.appendChild(canvas);

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
scene.add(fpsCam.camera);

const combatHud = document.createElement("section");
combatHud.className = "combat-hud";
combatHud.innerHTML = `
  <div class="combat-status"></div>
  <div class="crosshair">+</div>
  <div class="hitmarker">×</div>
  <div class="damage-number"></div>
  <div class="damage-direction">▲</div>
  <div class="zoom-overlay"></div>
  <div class="death-overlay">ELIMINATED<br><small>respawning…</small></div>
  <ol class="killfeed"></ol>
  <div class="scoreboard"><h2>SCOREBOARD</h2><div class="scoreboard-body"></div></div>`;
root.appendChild(combatHud);
const statusElement = combatHud.querySelector<HTMLDivElement>(".combat-status")!;
const hitmarker = combatHud.querySelector<HTMLDivElement>(".hitmarker")!;
const damageNumber = combatHud.querySelector<HTMLDivElement>(".damage-number")!;
const damageDirection = combatHud.querySelector<HTMLDivElement>(".damage-direction")!;
const zoomOverlay = combatHud.querySelector<HTMLDivElement>(".zoom-overlay")!;
const deathOverlay = combatHud.querySelector<HTMLDivElement>(".death-overlay")!;
const killfeed = combatHud.querySelector<HTMLOListElement>(".killfeed")!;
const scoreboard = combatHud.querySelector<HTMLDivElement>(".scoreboard")!;
const scoreboardBody = combatHud.querySelector<HTMLDivElement>(".scoreboard-body")!;
let scoreboardHeld = false;
document.addEventListener("keydown", (event) => {
  if (event.code === "Tab") {
    scoreboardHeld = true;
    event.preventDefault();
  }
});
document.addEventListener("keyup", (event) => {
  if (event.code === "Tab") scoreboardHeld = false;
});

let audio: AudioContext | undefined;
canvas.addEventListener("pointerdown", () => {
  audio ??= new AudioContext();
  void audio.resume();
}, { once: true });
const beep = (frequency: number, duration = 0.055): void => {
  if (audio === undefined) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.06, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + duration);
};

const weaponMaterial = new MeshStandardMaterial({ color: 0x66ccff, roughness: 0.45 });
const weaponMesh = new Mesh(new BoxGeometry(0.18, 0.16, 0.7), weaponMaterial);
weaponMesh.position.set(0.28, -0.25, -0.62);
weaponMesh.rotation.set(-0.08, -0.06, 0);
fpsCam.camera.add(weaponMesh);

const weaponColor = (weaponId: number): number => {
  const palette = [
    0x66ccff, 0x67e89a, 0xff8a5b, 0xd1d7e5, 0xb78cff, 0xf2f2f2,
    0xffd166, 0xf06a6a, 0x65f5ff, 0xff7b36, 0x55aaff, 0xb9ffea, 0xffd700,
  ];
  return palette[weaponId] ?? 0xffffff;
};

document.addEventListener("visibilitychange", () => {
  const frame = input.sampleTick();
  sim.applyInput({
    buttons: frame.buttons,
    viewYaw: frame.yaw * RAD2DEG,
    viewPitch: frame.pitch * RAD2DEG,
    fireFraction: 0,
  });
});

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
const remoteMeshes = new Map<number, Mesh>();
const remoteMaterial = new MeshStandardMaterial({
  color: 0xd75d5d,
  roughness: 0.9,
});
const projectileMeshes = new Map<string, Mesh>();

const addKillfeed = (text: string): void => {
  const item = document.createElement("li");
  item.textContent = text;
  killfeed.prepend(item);
  while (killfeed.children.length > 6) killfeed.lastElementChild?.remove();
  setTimeout(() => item.remove(), 5_000);
};

const showTracer = (
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  headshot: boolean,
): void => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(Float32Array.of(
    from.x, from.y + 1.55, from.z,
    to.x, to.y + 0.95, to.z,
  ), 3));
  const tracer = new Line(geometry, new LineBasicMaterial({ color: headshot ? 0xffdd55 : 0xffffff }));
  const impact = new Mesh(
    new SphereGeometry(0.08, 6, 4),
    new MeshStandardMaterial({ color: headshot ? 0xffdd55 : 0xffffff, emissive: headshot ? 0xaa7700 : 0x555555 }),
  );
  impact.position.set(to.x, to.y + 0.95, to.z);
  scene.add(tracer, impact);
  setTimeout(() => {
    scene.remove(tracer, impact);
    geometry.dispose();
  }, 90);
};

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dtMs = now - lastFrame;
  lastFrame = now;
  fpsSmoothed = fpsSmoothed * 0.95 + (1000 / Math.max(dtMs, 0.1)) * 0.05;

  // Feed the freshest view + buttons into the sim (sim speaks degrees).
  const f = input.sampleTick();
  sim.applyInput({
    buttons: f.buttons,
    viewYaw: (f.fireFraction >= 0 ? f.firedYaw : f.yaw) * RAD2DEG,
    viewPitch: (f.fireFraction >= 0 ? f.firedPitch : f.pitch) * RAD2DEG,
    fireFraction: f.fireFraction >= 0 ? f.fireFraction : 0,
  });

  const prev = sim.getPrevState().player;
  const curr = sim.getState().player;
  const combat = sim.getCombatState();
  const a = sim.getAlpha();
  const collisionPx = prev.position.x + (curr.position.x - prev.position.x) * a;
  const collisionPy = prev.position.y + (curr.position.y - prev.position.y) * a;
  const collisionPz = prev.position.z + (curr.position.z - prev.position.z) * a;
  const renderPosition = sim.getRenderPosition(dtMs / 1_000);
  const px = collisionPx + renderPosition.x - curr.position.x;
  const py = collisionPy + renderPosition.y - curr.position.y;
  const pz = collisionPz + renderPosition.z - curr.position.z;

  if (curr.grounded && !wasGrounded && curr.velocity.y <= 0) fpsCam.onLand();
  wasGrounded = curr.grounded;

  // Camera angles come straight from input (radians) — never from the 64 Hz sim.
  const duckP = prev.duckProgress + (curr.duckProgress - prev.duckProgress) * a;
  fpsCam.update(px, py, pz, input.yaw, input.pitch, dtMs, duckP);

  const zoomCapable = combat.weaponId === 4 || combat.weaponId === 11;
  const zoomed = zoomCapable && (f.buttons & Button.Zoom) !== 0 && combat.alive;
  const targetFov = zoomed ? 45 : 100;
  fpsCam.camera.fov += (targetFov - fpsCam.camera.fov) * Math.min(1, dtMs / 80);
  fpsCam.camera.updateProjectionMatrix();
  zoomOverlay.classList.toggle("visible", zoomed);

  const vx = curr.velocity.x;
  const vz = curr.velocity.z;
  panel.update(Math.hypot(vx, vz), fpsSmoothed, renderer.info.render.drawCalls);

  const remotes = sim.getRemotePlayers(now);
  const visibleRemotes = new Set<number>();
  for (const remote of remotes) {
    if (remote.kind !== EntityKind.Player) continue;
    visibleRemotes.add(remote.id);
    let mesh = remoteMeshes.get(remote.id);
    if (mesh === undefined) {
      mesh = new Mesh(new BoxGeometry(0.8, 1.8, 0.8), remoteMaterial);
      remoteMeshes.set(remote.id, mesh);
      scene.add(mesh);
    }
    mesh.position.set(remote.position.x, remote.position.y + 0.9, remote.position.z);
    mesh.visible = remote.alive;
  }
  for (const [id, mesh] of remoteMeshes) {
    if (!visibleRemotes.has(id)) mesh.visible = false;
  }

  const projectileViews = new Map<string, {
    position: { x: number; y: number; z: number };
    weaponId: number;
  }>();
  for (const remote of remotes) {
    if (remote.kind !== EntityKind.Projectile) continue;
    projectileViews.set(`r:${remote.id}`, { position: remote.position, weaponId: remote.weaponId });
  }
  for (const predicted of combat.predictedProjectiles) {
    const replicated = [...projectileViews.values()].some((view) =>
      view.weaponId === predicted.weaponId &&
      Math.hypot(
        view.position.x - predicted.position.x,
        view.position.y - predicted.position.y,
        view.position.z - predicted.position.z,
      ) < 0.8);
    if (!replicated) projectileViews.set(`p:${predicted.ownerId}:${predicted.fireCmdSeq}`, {
      position: predicted.position,
      weaponId: predicted.weaponId,
    });
  }
  for (const [key, projectile] of projectileViews) {
    let mesh = projectileMeshes.get(key);
    if (mesh === undefined) {
      mesh = new Mesh(
        new SphereGeometry(projectile.weaponId === 9 ? 0.16 : 0.11, 8, 6),
        new MeshStandardMaterial({
          color: weaponColor(projectile.weaponId),
          emissive: weaponColor(projectile.weaponId),
          emissiveIntensity: 0.7,
        }),
      );
      projectileMeshes.set(key, mesh);
      scene.add(mesh);
    }
    mesh.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
    mesh.visible = true;
  }
  for (const [key, mesh] of projectileMeshes) {
    if (!projectileViews.has(key)) {
      scene.remove(mesh);
      projectileMeshes.delete(key);
    }
  }

  const mode = combat.modeState;
  const ladderLength = mode === undefined
    ? CLASSIC_LADDER.length
    : ladderWeapons(mode.ladder).length;
  const ammoText = combat.weaponId === 12 ? ` · ammo ${combat.ammo}/1` : "";
  statusElement.textContent = `${WEAPONS[combat.weaponId].displayName} · tier ${combat.tier}/${ladderLength}${ammoText} · ${combat.health} hp`;
  deathOverlay.classList.toggle("visible", !combat.alive);
  weaponMesh.visible = combat.alive;
  weaponMaterial.color.setHex(weaponColor(combat.weaponId));
  scoreboard.classList.toggle("visible", scoreboardHeld || mode?.roundState === RoundState.ScoreboardFreeze);
  if (mode !== undefined) {
    const scoreHeading = mode.mode === 1
      ? `<strong>${mode.teamScores[0]} — ${mode.teamScores[1]}</strong>`
      : mode.winnerId === 0 ? "" : `<strong>P${mode.winnerId} wins</strong>`;
    scoreboardBody.innerHTML = `${scoreHeading}${mode.scoreboard.map((entry) =>
      `<div><span>P${entry.playerId}${entry.team === 0 ? "" : ` · T${entry.team}`}</span><span>${entry.kills}/${entry.deaths} · tier ${entry.tier}</span></div>`).join("")}`;
  }

  for (const event of sim.drainCombatEvents()) {
    const headshot = (event.flags & EventFlags.Headshot) !== 0;
    if (event.kind === EventKind.HitConfirm && event.actorId === combat.selfId) {
      hitmarker.classList.add("visible");
      damageNumber.textContent = String(event.amount);
      damageNumber.classList.add("visible");
      beep(260 + event.amount * 4);
      if (headshot) beep(1_050, 0.09);
      const target = remotes.find((remote) => remote.id === event.targetId);
      if (target !== undefined) showTracer(curr.position, target.position, headshot);
      setTimeout(() => {
        hitmarker.classList.remove("visible");
        damageNumber.classList.remove("visible");
      }, 120);
    }
    if (event.kind === EventKind.Damage && event.targetId === combat.selfId) {
      const attacker = remotes.find((remote) => remote.id === event.actorId);
      if (attacker !== undefined) {
        const dx = attacker.position.x - curr.position.x;
        const dz = attacker.position.z - curr.position.z;
        const worldAngle = Math.atan2(dx, -dz);
        damageDirection.style.transform = `translate(-50%, -50%) rotate(${worldAngle - input.yaw}rad)`;
      }
      damageDirection.classList.add("visible");
      setTimeout(() => damageDirection.classList.remove("visible"), 350);
    }
    if (event.kind === EventKind.Kill) {
      const suicide = (event.flags & EventFlags.Suicide) !== 0;
      addKillfeed(suicide
        ? `P${event.targetId} suicide`
        : `P${event.actorId} → P${event.targetId}${headshot ? " [HEAD]" : ""}`);
      if (event.actorId === combat.selfId && !suicide) beep(720, 0.12);
    }
    if (event.kind === EventKind.Airshot && event.actorId === combat.selfId) {
      addKillfeed(`AIRSHOT · P${event.targetId}`);
      beep(1_480, 0.16);
    }
  }

  void renderer.render(scene, fpsCam.camera);
});
}

function showNameEntry(): void {
  const shell = document.createElement("main");
  shell.className = "join-screen";
  shell.innerHTML = `
    <form class="join-card">
      <h1>GUNGAME</h1>
      <p>Type a name and join quickplay.</p>
      <input name="name" minlength="2" maxlength="16" pattern="[a-zA-Z0-9_ -]+" autocomplete="nickname" autofocus>
      <button type="submit">Play</button>
      <small>Dev: ?mode=scoutz|gungame&amp;ladder=classic|arsenal&amp;gravity=standard|scoutz</small>
    </form>`;
  root.appendChild(shell);
  const form = shell.querySelector<HTMLFormElement>("form");
  const input = shell.querySelector<HTMLInputElement>("input");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = input?.value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "") ?? "";
    if (!/^[a-zA-Z0-9_ -]{2,16}$/.test(name)) {
      input?.setCustomValidity("Use 2–16 letters, numbers, spaces, _ or -");
      input?.reportValidity();
      return;
    }
    sessionStorage.setItem("gg:name", name);
    const url = new URL(location.href);
    url.searchParams.set("name", name);
    location.assign(url);
  });
}

const requestedName = new URLSearchParams(location.search).get("name") ?? sessionStorage.getItem("gg:name");
if (requestedName === null || !/^[a-zA-Z0-9_ -]{2,16}$/.test(requestedName)) showNameEntry();
else startGame();
