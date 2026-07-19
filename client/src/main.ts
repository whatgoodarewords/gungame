import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RenderPipeline,
  Scene,
  SphereGeometry,
  Vector3,
  WebGPURenderer,
  type Material,
} from "three/webgpu";
import { pass, toonOutlinePass } from "three/tsl";

import foundryBlobUrl from "../../maps/foundry.blob?url";
import dunaBlobUrl from "../../maps/duna.blob?url";
import cascadeBlobUrl from "../../maps/cascade.blob?url";
import spireBlobUrl from "../../maps/spire.blob?url";
import {
  CLASSIC_LADDER,
  MapSecretKind,
  TICK_DT,
  WEAPONS,
  ladderWeapons,
  loadGameplayMap,
  type GameplayMap,
  type WeaponIdValue,
} from "../../packages/shared/src/index.js";
import {
  EntityKind,
  EventFlags,
  EventKind,
  GameMode,
  MapId,
  RefusalCode,
  RoundState,
} from "../../packages/protocol/src/index.js";
import { DEFAULT, SCOUTZ } from "../../packages/sim/src/index.js";
import { GameAudio, type SurfaceMaterial } from "./audio.js";
import { BHOP_ROUTES, BhopTimeTrial } from "./bhop-ghost.js";
import { FpsCamera } from "./camera.js";
import { ClipThat } from "./clip-capture.js";
import { ProjectileVisualSystem, RemoteCharacterSystem } from "./combat-visuals.js";
import { MatchHud } from "./hud.js";
import { HudStateMachine } from "./hud-state.js";
import { Button, RawInput, rebindControl } from "./input.js";
import {
  likelyTouchOnly,
  showMobileGate,
  showNameEntry,
  validPlayerName,
  type MenuController,
  type MenuSelection,
} from "./menu.js";
import { matchStatsShareText, updatePersonalBest } from "./match-stats.js";
import { DevPanel } from "./panel.js";
import {
  clearReconnectAttempts,
  nextReconnectAttempt,
  RECONNECT_ATTEMPT_STORAGE_KEY,
} from "./reconnect.js";
import {
  RENDER_STYLES,
  RENDER_STYLE_IDS,
  renderStyleFromQuery,
  type RenderMaterials,
  type RenderStyleId,
  type StyleRig,
} from "./render-style.js";
import { createPlayground } from "./sim-bridge.js";
import {
  crosshairGapPixels,
  loadUserSettings,
  pingTone,
  saveUserSettings,
  weaponTypeIcon,
  type UserSettings,
} from "./settings.js";
import { WeaponViewmodel } from "./viewmodels.js";
import { RecoverableRenderPipeline, armRecoverableAnimationLoop } from "./render-runtime.js";
import "./style.css";

const RAD2DEG = 180 / Math.PI;
const appRoot = document.querySelector<HTMLDivElement>("#app");
if (appRoot === null) throw new Error("missing #app");
const root: HTMLDivElement = appRoot;

function pointInside(
  point: { x: number; y: number; z: number },
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
): boolean {
  return point.x >= bounds.min.x && point.x <= bounds.max.x &&
    point.y >= bounds.min.y && point.y <= bounds.max.y &&
    point.z >= bounds.min.z && point.z <= bounds.max.z;
}

async function startGame(frontDoor?: MenuController): Promise<void> {
  const query = new URLSearchParams(location.search);
  const canvas = document.createElement("canvas");
  root.appendChild(canvas);
  const scene = new Scene();
  let userSettings: UserSettings = loadUserSettings(localStorage);
  const fpsCam = new FpsCamera(window.innerWidth / window.innerHeight, userSettings.fov);
  fpsCam.camera.layers.enable(1);
  scene.add(fpsCam.camera);
  const input = new RawInput(() =>
    canvas.isConnected ? canvas : root.querySelector<HTMLCanvasElement>("canvas:last-of-type") ?? canvas);
  const hud = new MatchHud(root);
  const hudState = new HudStateMachine(true);
  hud.setState(hudState.state);
  const audio = new GameAudio();
  let clipMapName = "map";
  const clip = new ClipThat(canvas, () => clipMapName, () => audio.captureStream);
  audio.setMaster(userSettings.masterVolume, userSettings.muted);
  const unlockAudio = (): void => {
    audio.unlock();
    clip.start();
  };
  document.addEventListener("pointerdown", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });
  document.addEventListener("click", (event) => {
    if ((event.target as Element | null)?.closest("button, select, input") !== null) {
      audio.uiClick();
    }
  });
  input.onLockChange((locked) => hud.setPointerLock(locked));
  hud.onResume(() => input.requestLock());

  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: query.get("backend") === "webgl2",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  await renderer.init();
  const showConnectionCard = (
    state: "server-restarting" | "version-mismatch" | "room-full" | "room-not-found",
  ): void => {
    if (frontDoor === undefined) {
      frontDoor = showNameEntry(root, (selection) => location.assign(urlForSelection(selection)));
    }
    frontDoor.setConnectionState(state);
  };
  let currentMap: GameplayMap | undefined;
  let currentMode: typeof GameMode[keyof typeof GameMode] = GameMode.Scoutzknivez;
  let currentStyleId = renderStyleFromQuery(location.search);
  let currentStyle = RENDER_STYLES[currentStyleId];
  let materials: RenderMaterials | undefined;
  let rig: StyleRig | undefined;
  let mapMesh: Mesh | undefined;
  let timeTrial: BhopTimeTrial | undefined;
  let ghostMesh: Mesh | undefined;
  let raceMarkers: Mesh[] = [];
  let viewmodel: WeaponViewmodel | undefined;
  let characters: RemoteCharacterSystem | undefined;
  let projectiles: ProjectileVisualSystem | undefined;
  let currentRoomId = "";
  let connectedAtMs = performance.now();
  let networkClosed = false;
  let reconnectScheduled = false;
  let reconnectCountdownTimer: ReturnType<typeof setInterval> | undefined;
  const nameplates = new Map<number, HTMLElement>();

  const constructPipeline = (style: typeof currentStyle): RenderPipeline => {
    const scenePass = style.id === "toon-cel"
      ? toonOutlinePass(scene, fpsCam.camera, new Color(style.palette.ink), 0.0035, 1)
      : pass(scene, fpsCam.camera);
    return new RenderPipeline(renderer, style.postChain(scenePass));
  };

  rig = currentStyle.fogLightRig(scene);
  const pipeline = new RecoverableRenderPipeline(
    constructPipeline(currentStyle),
    (error) => console.error(
      `render style rebuild failed (${query.get("backend") === "webgl2" ? "webgl2" : "webgpu"})`,
      error,
    ),
  );

  const applyStyle = (id: RenderStyleId): void => {
    pipeline.cancelPending();
    const nextStyle = RENDER_STYLES[id];
    const previous = {
      id: currentStyleId,
      style: currentStyle,
      rig,
      materials,
      viewmodel,
    };
    const nextPipeline = constructPipeline(nextStyle);
    const nextMaterials = currentMap === undefined ? undefined : nextStyle.materials(currentMap);
    const nextViewmodel = nextMaterials === undefined ? undefined : new WeaponViewmodel(nextMaterials.viewmodel);
    const nextRig = nextStyle.fogLightRig(scene);
    if (previous.viewmodel !== undefined) previous.viewmodel.root.visible = false;
    if (nextViewmodel !== undefined) fpsCam.camera.add(nextViewmodel.root);
    currentStyleId = id;
    currentStyle = nextStyle;
    rig = nextRig;
    materials = nextMaterials;
    if (currentMap !== undefined) {
      if (mapMesh !== undefined && nextMaterials !== undefined) mapMesh.material = nextMaterials.map;
      if (nextMaterials !== undefined) {
        characters?.setMaterial(nextMaterials.actor);
        projectiles?.setMaterial(nextMaterials.projectile);
      }
    }
    viewmodel = nextViewmodel;
    pipeline.replace(nextPipeline, () => {
      previous.rig?.dispose();
      if (previous.viewmodel !== undefined) fpsCam.camera.remove(previous.viewmodel.root);
    }, () => {
      nextRig.dispose();
      if (nextViewmodel !== undefined) fpsCam.camera.remove(nextViewmodel.root);
      previous.rig?.dispose();
      rig = previous.style.fogLightRig(scene);
      currentStyleId = previous.id;
      currentStyle = previous.style;
      materials = previous.materials;
      viewmodel = previous.viewmodel;
      if (previous.viewmodel !== undefined) previous.viewmodel.root.visible = true;
      if (mapMesh !== undefined && previous.materials !== undefined) mapMesh.material = previous.materials.map;
      if (previous.materials !== undefined) {
        characters?.setMaterial(previous.materials.actor);
        projectiles?.setMaterial(previous.materials.projectile);
      }
      const url = new URL(location.href);
      url.searchParams.set("style", previous.id);
      history.replaceState(null, "", url);
    });
  };

  const installVisualMap = (
    map: GameplayMap,
    mode: typeof GameMode[keyof typeof GameMode],
    mapId: typeof MapId[keyof typeof MapId],
  ): void => {
    currentMap = map;
    currentMode = mode;
    clipMapName = mapId === MapId.Spire
      ? "spire"
      : mapId === MapId.Duna
        ? "duna"
        : mapId === MapId.Cascade
          ? "cascade"
          : "foundry";
    timeTrial = new BhopTimeTrial(BHOP_ROUTES[mapId], localStorage);
    if (ghostMesh !== undefined) {
      scene.remove(ghostMesh);
      ghostMesh.geometry.dispose();
    }
    const ghostMaterial = new MeshBasicNodeMaterial({
      color: currentStyle.palette.accent,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    ghostMesh = new Mesh(new SphereGeometry(0.42, 12, 8), ghostMaterial);
    ghostMesh.name = "personal-best-ghost";
    ghostMesh.visible = false;
    scene.add(ghostMesh);
    for (const marker of raceMarkers) {
      scene.remove(marker);
      marker.geometry.dispose();
    }
    raceMarkers = map.secrets
      .filter((secret) => secret.kind === MapSecretKind.RaceSpot)
      .map((secret, index) => {
        const markerMaterial = new MeshBasicNodeMaterial({
          color: currentStyle.palette.accent,
          transparent: true,
          opacity: 0.76,
          depthWrite: false,
        });
        const marker = new Mesh(new SphereGeometry(0.18, 8, 6), markerMaterial);
        marker.position.set(
          (secret.bounds.min.x + secret.bounds.max.x) / 2,
          (secret.bounds.min.y + secret.bounds.max.y) / 2,
          (secret.bounds.min.z + secret.bounds.max.z) / 2,
        );
        marker.name = `race-spot-glint-${index + 1}`;
        marker.userData.phase = index * Math.PI;
        const receiptCanvas = document.createElement("canvas");
        receiptCanvas.width = 256;
        receiptCanvas.height = 128;
        const receiptContext = receiptCanvas.getContext("2d");
        if (receiptContext !== null) {
          const accentCss = new Color(currentStyle.palette.accent).getStyle();
          receiptContext.fillStyle = "#071018";
          receiptContext.fillRect(0, 0, 256, 128);
          receiptContext.strokeStyle = accentCss;
          receiptContext.lineWidth = 5;
          receiptContext.strokeRect(6, 6, 244, 116);
          receiptContext.fillStyle = "#ffffff";
          receiptContext.font = "800 52px ui-monospace, monospace";
          receiptContext.fillText("gg", 18, 62);
          receiptContext.fillStyle = accentCss;
          receiptContext.font = "600 18px ui-monospace, monospace";
          receiptContext.fillText("ari · noor · rowan", 18, 98);
        }
        const receipt = new Mesh(
          new PlaneGeometry(1.45, 0.72),
          new MeshBasicNodeMaterial({
            map: new CanvasTexture(receiptCanvas),
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          }),
        );
        receipt.position.y = 0.58;
        receipt.userData.secretReceipt = "names-wall";
        marker.add(receipt);
        scene.add(marker);
        return marker;
      });
    if (mapMesh !== undefined) {
      scene.remove(mapMesh);
      mapMesh.geometry.dispose();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(map.collision.positions, 3));
    geometry.setIndex(new BufferAttribute(map.collision.indices, 1));
    geometry.computeVertexNormals();
    materials = currentStyle.materials(map);
    characters ??= new RemoteCharacterSystem(scene, materials.actor);
    projectiles ??= new ProjectileVisualSystem(scene, materials.projectile);
    characters.setMaterial(materials.actor);
    projectiles.setMaterial(materials.projectile);
    mapMesh = new Mesh(geometry, materials.map);
    mapMesh.name = mapId === MapId.Spire
      ? "Spire"
      : mapId === MapId.Duna
        ? "Duna"
        : mapId === MapId.Cascade
          ? "Cascade"
          : "Foundry";
    scene.add(mapMesh);
    if (viewmodel !== undefined) fpsCam.camera.remove(viewmodel.root);
    viewmodel = new WeaponViewmodel(materials.viewmodel);
    fpsCam.camera.add(viewmodel.root);
    applyStyle(currentStyleId);
    document.title = `gungame — ${mapMesh.name.toLowerCase()}`;
  };

  const mapUrlForMap = (mapId: typeof MapId[keyof typeof MapId]): string =>
    mapId === MapId.Spire
      ? spireBlobUrl
      : mapId === MapId.Duna
        ? dunaBlobUrl
        : mapId === MapId.Cascade
          ? cascadeBlobUrl
          : foundryBlobUrl;
  const mapUrlForMode = (mode: typeof GameMode[keyof typeof GameMode]): string =>
    mapUrlForMap(mode === GameMode.Scoutzknivez ? MapId.Spire : MapId.Foundry);

  const scheduleReconnect = (): void => {
    if (reconnectScheduled) return;
    reconnectScheduled = true;
    const retry = nextReconnectAttempt(sessionStorage, Date.now());
    if (!retry.allowed) {
      hud.setReconnectCountdown(0);
      return;
    }
    let remaining = retry.countdownSeconds;
    hud.setReconnectCountdown(remaining);
    reconnectCountdownTimer = setInterval(() => {
      remaining -= 1;
      hud.setReconnectCountdown(Math.max(0, remaining));
      if (remaining > 0) return;
      if (reconnectCountdownTimer !== undefined) clearInterval(reconnectCountdownTimer);
      location.reload();
    }, 1_000);
  };
  hud.onRejoin(() => {
    sessionStorage.removeItem(RECONNECT_ATTEMPT_STORAGE_KEY);
    if (currentRoomId !== "") sessionStorage.removeItem(`gg:reconnect:${currentRoomId}`);
    location.reload();
  });

  const { sim } = createPlayground(canvas, {
    mapUrlForMode,
    mapUrlForMap,
    onMapLoaded: installVisualMap,
    onWelcome: (_mode, _variant, _ladder, _mapId, roomId) => {
      clearReconnectAttempts(sessionStorage);
      reconnectScheduled = false;
      currentRoomId = roomId;
      connectedAtMs = performance.now();
      networkClosed = false;
      audio.uiConfirm();
      hud.setState(hudState.dispatch({ type: "connected" }));
      frontDoor?.destroy();
      frontDoor = undefined;
      if (query.get("create") === "1") hud.showInvite(roomId);
    },
    onRefusal: (code) => {
      audio.uiError();
      if (code === RefusalCode.VersionMismatch) {
        showConnectionCard("version-mismatch");
        hud.setState(hudState.dispatch({ type: "version-mismatch" }));
      } else if (code === RefusalCode.ServerRestarting) {
        showConnectionCard("server-restarting");
        hud.setState(hudState.dispatch({ type: "server-restarting" }));
      } else if (code === RefusalCode.RoomFull) {
        showConnectionCard("room-full");
      } else if (code === RefusalCode.RoomNotFound) {
        showConnectionCard("room-not-found");
      } else {
        hud.setState(hudState.dispatch({ type: "connection-lost" }));
      }
    },
    onClose: (code, reason) => {
      networkClosed = true;
      const restarting = code === 1012 || reason.toLowerCase().includes("restart");
      if (restarting) showConnectionCard("server-restarting");
      hud.setConnectionTelemetry(code, reason);
      hud.setState(hudState.dispatch({ type: restarting ? "server-restarting" : "connection-lost" }));
      scheduleReconnect();
    },
  });

  const params = { ...SCOUTZ };
  let jumpBufferMs = 80;
  sim.setParams(params);
  const panel = new DevPanel({
    params: { ...params, jumpBufferMs },
    onParamChange: (key, value) => {
      if (key === "jumpBufferMs") {
        jumpBufferMs = value;
        sim.setFeel({ jumpBufferMs });
      } else {
        (params as Record<string, number>)[key] = value;
        sim.setParams(params);
      }
    },
    presets: {
      scoutz: { ...SCOUTZ, jumpBufferMs: 80 },
      default: { ...DEFAULT, jumpBufferMs: 80 },
    },
    onPreset: (name) => {
      Object.assign(params, name === "scoutz" ? SCOUTZ : DEFAULT);
      sim.setParams(params);
    },
    onSensitivity: (cm360, dpi) => input.setSensitivity(cm360, dpi),
    controls: input.controlBindings,
    onControl: (action, code) => {
      input.setBindings(rebindControl(input.controlBindings, action, code));
    },
    settings: userSettings,
    onSettings: (settings) => {
      userSettings = settings;
      saveUserSettings(localStorage, settings);
      audio.setMaster(settings.masterVolume, settings.muted);
    },
    styles: RENDER_STYLE_IDS,
    activeStyle: currentStyleId,
    onStyle: (style) => {
      if (!RENDER_STYLE_IDS.includes(style as RenderStyleId)) return;
      const id = style as RenderStyleId;
      const previousId = currentStyleId;
      try {
        applyStyle(id);
        const url = new URL(location.href);
        url.searchParams.set("style", id);
        history.replaceState(null, "", url);
      } catch (error) {
        console.error("render style application failed before pipeline activation", error);
        if (currentStyleId !== previousId) applyStyle(previousId);
      }
    },
  });

  let scoreboardHeld = false;
  document.addEventListener("keydown", (event) => {
    if (event.code === input.controlBindings.clip[0]) {
      clip.export();
      event.preventDefault();
      return;
    }
    if (event.code !== "Tab") return;
    scoreboardHeld = true;
    event.preventDefault();
  });
  document.addEventListener("keyup", (event) => {
    if (event.code === "Tab") scoreboardHeld = false;
  });
  document.addEventListener("visibilitychange", () => {
    const frame = input.sampleTick();
    sim.applyInput({
      buttons: frame.buttons,
      viewYaw: frame.yaw * RAD2DEG,
      viewPitch: frame.pitch * RAD2DEG,
      fireFraction: 0,
    });
    if (!document.hidden) hud.setPointerLock(input.isLocked, false);
  });
  hud.setPointerLock(input.isLocked);

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
      materials?.projectile ?? new LineBasicMaterial({ color: 0xffffff }),
    );
    impact.position.set(to.x, to.y + 0.95, to.z);
    scene.add(tracer, impact);
    setTimeout(() => {
      scene.remove(tracer);
      geometry.dispose();
    }, 40);
    setTimeout(() => scene.remove(impact), 120);
  };

  const showAimTracer = (range: number): void => {
    const origin = fpsCam.camera.getWorldPosition(new Vector3());
    const direction = fpsCam.camera.getWorldDirection(new Vector3());
    const end = origin.clone().addScaledVector(direction, range);
    const geometry = new BufferGeometry().setFromPoints([origin, end]);
    const tracer = new Line(geometry, new LineBasicMaterial({
      color: currentStyle.palette.accent,
      transparent: true,
      opacity: 0.8,
    }));
    tracer.name = "hitscan-tracer";
    scene.add(tracer);
    setTimeout(() => {
      scene.remove(tracer);
      geometry.dispose();
    }, 40);
  };

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    fpsCam.camera.aspect = window.innerWidth / window.innerHeight;
    fpsCam.camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();
  try {
    applyStyle(currentStyleId);
  } catch (error) {
    console.error("initial render style application failed", error);
  }

  let wasGrounded = true;
  let lastFrame = performance.now();
  let fpsSmoothed = 0;
  let lastWeapon: WeaponIdValue | undefined;
  let nextLocalShotMs = 0;
  let nextFootstepMs = 0;
  let nextWhooshMs = 0;
  let lastYaw = input.yaw;
  let lastPitch = input.pitch;
  let lastTier = 1;
  let wasAlive = true;
  let deathAtMs = 0;
  let deathPosition = { x: 0, y: 0, z: 0 };
  let lastKiller = { name: "world", weapon: "unknown", health: 0 };
  let killStreak = 0;
  let howToShown = false;
  const nameplateRaycaster = new Raycaster();
  const nextRemoteFootstep = new Map<number, number>();

  const renderFrame = (): void => {
    const now = performance.now();
    const dtMs = Math.min(100, now - lastFrame);
    lastFrame = now;
    fpsSmoothed = fpsSmoothed * 0.95 + (1000 / Math.max(dtMs, 0.1)) * 0.05;
    const frame = input.sampleTick();
    sim.applyInput({
      buttons: frame.buttons,
      viewYaw: (frame.fireFraction >= 0 ? frame.firedYaw : frame.yaw) * RAD2DEG,
      viewPitch: (frame.fireFraction >= 0 ? frame.firedPitch : frame.pitch) * RAD2DEG,
      fireFraction: frame.fireFraction >= 0 ? frame.fireFraction : 0,
    });

    const prev = sim.getPrevState().player;
    const curr = sim.getState().player;
    const combat = sim.getCombatState();
    const alpha = sim.getAlpha();
    const collision = {
      x: prev.position.x + (curr.position.x - prev.position.x) * alpha,
      y: prev.position.y + (curr.position.y - prev.position.y) * alpha,
      z: prev.position.z + (curr.position.z - prev.position.z) * alpha,
    };
    const rendered = sim.getRenderPosition(dtMs / 1_000);
    const px = collision.x + rendered.x - curr.position.x;
    const py = collision.y + rendered.y - curr.position.y;
    const pz = collision.z + rendered.z - curr.position.z;
    if (curr.grounded && !wasGrounded && curr.velocity.y <= 0) {
      fpsCam.onLand();
      audio.landing(currentMode === GameMode.Scoutzknivez ? "stone" : "metal", Math.abs(prev.velocity.y));
    }
    wasGrounded = curr.grounded;
    const duck = prev.duckProgress + (curr.duckProgress - prev.duckProgress) * alpha;
    if (!combat.alive && now - deathAtMs < 1_000) {
      const orbit = (now - deathAtMs) / 1_000 * Math.PI * 1.4;
      fpsCam.camera.position.set(
        deathPosition.x + Math.sin(orbit) * 3.2,
        deathPosition.y + 2,
        deathPosition.z + Math.cos(orbit) * 3.2,
      );
      fpsCam.camera.lookAt(deathPosition.x, deathPosition.y + 0.9, deathPosition.z);
    } else {
      fpsCam.update(px, py, pz, input.yaw, input.pitch, dtMs, duck);
    }
    audio.setListener(
      fpsCam.camera.position,
      fpsCam.camera.getWorldDirection(new Vector3()),
    );

    const zoomCapable = combat.weaponId === 4 || combat.weaponId === 11;
    const zoomed = zoomCapable && (frame.buttons & Button.Zoom) !== 0 && combat.alive;
    const targetFov = zoomed ? userSettings.fov * 0.45 : userSettings.fov;
    fpsCam.camera.fov += (targetFov - fpsCam.camera.fov) * Math.min(1, dtMs / 80);
    fpsCam.camera.updateProjectionMatrix();
    hud.zoomOverlay.classList.toggle("visible", zoomed);
    hud.setCrosshair(
      userSettings.crosshair,
      crosshairGapPixels(
        userSettings.crosshair,
        WEAPONS[combat.weaponId],
        zoomed,
        window.innerHeight,
        fpsCam.camera.fov,
      ),
      zoomed,
    );

    const horizontalSpeed = Math.hypot(curr.velocity.x, curr.velocity.z);
    const trial = timeTrial?.update(curr.position, now);
    hud.setTrialTimer(
      trial?.visible ?? false,
      trial?.elapsedMs ?? 0,
      trial?.bestMs,
    );
    if (ghostMesh !== undefined) {
      ghostMesh.visible = trial?.ghost !== undefined;
      if (trial?.ghost !== undefined) {
        ghostMesh.position.set(trial.ghost.x, trial.ghost.y + 0.9, trial.ghost.z);
      }
    }
    for (const marker of raceMarkers) {
      const pulse = 1 + Math.sin(now * 0.004 + Number(marker.userData.phase ?? 0)) * 0.28;
      marker.scale.setScalar(pulse);
      marker.rotation.y += dtMs * 0.0018;
      marker.lookAt(fpsCam.camera.position);
    }
    const roundTripMs = sim.getPingMs();
    hud.setPing(roundTripMs, pingTone(roundTripMs));
    hud.setAfkWarning(now - input.lastActivityMs >= 20_000);
    panel.update(fpsSmoothed, renderer.info.render.drawCalls);
    audio.setWindSpeed(horizontalSpeed);
    const surface: SurfaceMaterial = currentMode === GameMode.Scoutzknivez ? "stone" : "metal";
    if (curr.grounded && horizontalSpeed > 2.2 && now >= nextFootstepMs) {
      audio.footstep(surface, curr.position, true);
      nextFootstepMs = now + Math.max(180, 470 - horizontalSpeed * 10);
    }
    const secretRoom = currentMap?.secrets.find((secret) => secret.kind === MapSecretKind.SpireRoom);
    audio.setSpireSecretAmbience(secretRoom !== undefined && pointInside(curr.position, secretRoom.bounds));

    if (combat.weaponId !== lastWeapon) {
      lastWeapon = combat.weaponId;
      viewmodel?.setWeapon(combat.weaponId);
    }
    if ((frame.buttons & Button.Fire) !== 0 && combat.alive && now >= nextLocalShotMs) {
      viewmodel?.onFire();
      audio.playFire(combat.weaponId);
      const weapon = WEAPONS[combat.weaponId];
      if (weapon.kind !== "projectile" && weapon.kind !== "melee") {
        showAimTracer(weapon.range);
      }
      nextLocalShotMs = now + WEAPONS[combat.weaponId].refireTicks * TICK_DT * 1_000;
    }
    const seconds = Math.max(0.001, dtMs / 1_000);
    viewmodel?.update(
      seconds,
      combat.ammo,
      combat.alive,
      (input.yaw - lastYaw) / seconds,
      (input.pitch - lastPitch) / seconds,
    );
    lastYaw = input.yaw;
    lastPitch = input.pitch;

    const remotes = sim.getRemotePlayers(now);
    const remotePlayers = remotes.filter((remote) => remote.kind === EntityKind.Player);
    if (query.get("visualtest") === "1" && remotePlayers.length === 0) {
      remotePlayers.push({
        id: 65_000,
        generation: 1,
        sourceTick: 0,
        position: { x: curr.position.x + 2, y: curr.position.y, z: curr.position.z - 4 },
        velocity: { x: 2.5, y: 0, z: 0 },
        viewYaw: 0,
        viewPitch: 0,
        grounded: true,
        alive: true,
        ducked: false,
        kind: EntityKind.Player,
        health: 100,
        weaponTier: 1,
        ammo: 0,
        ownerId: 0,
        fireCmdSeq: 0,
        weaponId: 0,
      });
    }
    characters?.update(remotePlayers, now / 1_000);
    const visiblePlayerIds = new Set(remotePlayers.map((remote) => remote.id));
    for (const remote of remotePlayers) {
      const speed = Math.hypot(remote.velocity.x, remote.velocity.z);
      if (remote.grounded && remote.alive && speed > 2.2 &&
        now >= (nextRemoteFootstep.get(remote.id) ?? 0)) {
        audio.footstep(surface, remote.position, false);
        nextRemoteFootstep.set(remote.id, now + Math.max(190, 460 - speed * 9));
      }
      let label = nameplates.get(remote.id);
      if (label === undefined) {
        label = document.createElement("span");
        label.className = "enemy-nameplate";
        hud.root.appendChild(label);
        nameplates.set(remote.id, label);
      }
      const scoreEntry = combat.modeState?.scoreboard.find((entry) => entry.playerId === remote.id);
      label.textContent = scoreEntry?.name?.toLowerCase() ?? `p${remote.id}`;
      label.classList.toggle("bot", scoreEntry?.bot === true);
      const target = new Vector3(remote.position.x, remote.position.y + 1.9, remote.position.z);
      const fromCamera = target.clone().sub(fpsCam.camera.position);
      const distance = fromCamera.length();
      let occluded = false;
      if (mapMesh !== undefined && distance < 15) {
        nameplateRaycaster.set(fpsCam.camera.position, fromCamera.normalize());
        occluded = (nameplateRaycaster.intersectObject(mapMesh, false)[0]?.distance ?? Infinity) < distance - 0.2;
      }
      const projected = target.project(fpsCam.camera);
      const visible = remote.alive && distance < 15 && !occluded &&
        Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z < 1;
      label.classList.toggle("visible", visible);
      if (visible) {
        label.style.left = `${(projected.x * 0.5 + 0.5) * window.innerWidth}px`;
        label.style.top = `${(-projected.y * 0.5 + 0.5) * window.innerHeight}px`;
      }
    }
    for (const [id, label] of nameplates) {
      if (!visiblePlayerIds.has(id)) {
        label.remove();
        nameplates.delete(id);
        nextRemoteFootstep.delete(id);
      }
    }

    const projectileViews = new Map<string, { position: { x: number; y: number; z: number }; weaponId: number }>();
    for (const remote of remotes) {
      if (remote.kind === EntityKind.Projectile) {
        projectileViews.set(`r:${remote.id}`, { position: remote.position, weaponId: remote.weaponId });
      }
    }
    for (const predicted of combat.predictedProjectiles) {
      const replicated = [...projectileViews.values()].some((value) => value.weaponId === predicted.weaponId &&
        Math.hypot(
          value.position.x - predicted.position.x,
          value.position.y - predicted.position.y,
          value.position.z - predicted.position.z,
        ) < 0.8);
      if (!replicated) projectileViews.set(`p:${predicted.ownerId}:${predicted.fireCmdSeq}`, {
        position: predicted.position,
        weaponId: predicted.weaponId,
      });
    }
    const projectileList = [...projectileViews].map(([key, value]) => ({ key, ...value }));
    if (query.get("visualtest") === "1" && projectileList.length === 0) {
      projectileList.push({
        key: "visual-test-rocket",
        position: { x: curr.position.x + 1.5, y: curr.position.y + 1.2, z: curr.position.z - 3 },
        weaponId: 9,
      });
    }
    projectiles?.update(projectileList);
    if (now >= nextWhooshMs) {
      const nearest = projectileList
        .map((projectile) => ({
          projectile,
          distance: Math.hypot(
            projectile.position.x - curr.position.x,
            projectile.position.y - curr.position.y,
            projectile.position.z - curr.position.z,
          ),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearest !== undefined && nearest.distance < 7) {
        audio.projectileWhoosh(nearest.projectile.position, nearest.distance);
        nextWhooshMs = now + 180;
      }
    }
    const debugWindow = window as unknown as {
      __GG_VISUAL_DEBUG__?: Record<string, number | string>;
    };
    debugWindow.__GG_VISUAL_DEBUG__ = {
      projectileMeshes: projectileList.length,
      characterRigs: remotePlayers.length,
      drawCalls: renderer.info.render.drawCalls,
      style: currentStyleId,
      backend: query.get("backend") === "webgl2" ? "webgl2" : "webgpu",
      connected: networkClosed ? 0 : (combat.selfId === 0 ? 0 : 1),
      playerX: curr.position.x,
      playerZ: curr.position.z,
    };

    const mode = combat.modeState;
    const ladderLength = mode === undefined ? CLASSIC_LADDER.length : ladderWeapons(mode.ladder).length;
    hud.setSelfId(combat.selfId);
    hud.setStatus({
      health: combat.health,
      tier: combat.tier,
      ladderLength,
      weapon: WEAPONS[combat.weaponId].displayName,
      typeIcon: weaponTypeIcon(WEAPONS[combat.weaponId].kind),
      ...(WEAPONS[combat.weaponId].magazine === 0 ? {} : { ammo: [combat.ammo, WEAPONS[combat.weaponId].magazine] as const }),
      speed: horizontalSpeed,
    });
    if (!howToShown && combat.selfId !== 0 && localStorage.getItem("gg:how-to-seen") !== "1") {
      howToShown = true;
      hud.showHowTo([
        "wasd move · mouse aim · click fire",
        `${input.controlBindings.jump.map((code) => code.toLowerCase()).join("/")} jump · wheel down jump`,
        `${input.controlBindings.duck.map((code) => code.toLowerCase()).join("/")} duck · tab scores`,
        "spawn protection 1.5 s",
      ]);
    }
    if (combat.tier !== lastTier) {
      const demoted = combat.tier < lastTier;
      hud.showBanner(demoted ? `demoted · tier ${combat.tier}` : `tier ${combat.tier}`, demoted);
      if (!demoted) {
        audio.tierUp();
        if (combat.tier === ladderLength) audio.lastTierWarning();
      }
      lastTier = combat.tier;
    }
    if (wasAlive && !combat.alive) {
      deathAtMs = now;
      deathPosition = { ...curr.position };
      killStreak = 0;
    } else if (!wasAlive && combat.alive) {
      hud.showSpawnFade();
    }
    wasAlive = combat.alive;
    if (!combat.alive) {
      hud.setDeathDetails(
        lastKiller.name,
        lastKiller.weapon,
        lastKiller.health,
        Math.max(0, 2 - (now - deathAtMs) / 1_000),
      );
    }
    const frozen = mode?.roundState === RoundState.ScoreboardFreeze;
    hud.setState(hudState.dispatch({ type: "snapshot", alive: combat.alive, frozen }));
    if (mode !== undefined) {
      const heading = mode.mode === GameMode.Scoutzknivez
        ? `${mode.teamScores[0]} — ${mode.teamScores[1]}`
        : mode.winnerId === 0 ? "" : `P${mode.winnerId} wins`;
      hud.setScoreboard(mode.scoreboard, scoreboardHeld, mode.roundState, heading, {
        room: currentRoomId,
        elapsedSeconds: (now - connectedAtMs) / 1_000,
        ping: roundTripMs,
      });
    }

    for (const event of sim.drainCombatEvents()) {
      const headshot = (event.flags & EventFlags.Headshot) !== 0;
      if (event.kind === EventKind.HitConfirm && event.actorId === combat.selfId) {
        hud.hitmarker.classList.add("visible");
        hud.showDamageNumber(event.amount, headshot);
        hud.flashHit(false);
        audio.hitmarker(event.amount);
        if (headshot) audio.headshot();
        const target = remotes.find((remote) => remote.id === event.targetId);
        if (target !== undefined) {
          showTracer(curr.position, target.position, headshot);
          audio.playImpact(event.weaponId as WeaponIdValue, target.position);
        }
        setTimeout(() => {
          hud.hitmarker.classList.remove("visible");
        }, 120);
      }
      if (event.kind === EventKind.Damage && event.targetId === combat.selfId) {
        const attacker = remotes.find((remote) => remote.id === event.actorId);
        if (attacker !== undefined) {
          const worldAngle = Math.atan2(attacker.position.x - curr.position.x, -(attacker.position.z - curr.position.z));
          hud.damageDirection.style.transform = `translate(-50%, -50%) rotate(${worldAngle - input.yaw}rad)`;
        }
        hud.damageDirection.classList.add("visible");
        setTimeout(() => hud.damageDirection.classList.remove("visible"), 350);
      }
      if (event.kind === EventKind.Kill) {
        const suicide = (event.flags & EventFlags.Suicide) !== 0;
        const killLine = suicide
          ? `P${event.targetId} suicide`
          : `P${event.actorId} → P${event.targetId}${headshot ? " [HEAD]" : ""}`;
        hud.addKillfeed(killLine,
          event.actorId === combat.selfId || event.targetId === combat.selfId);
        clip.recordKillfeed(killLine);
        if (event.targetId === combat.selfId) {
          const attacker = remotes.find((remote) => remote.id === event.actorId);
          lastKiller = {
            name: suicide ? "yourself" : `p${event.actorId}`,
            weapon: WEAPONS[event.weaponId as WeaponIdValue]?.displayName ?? "world",
            health: attacker?.health ?? 0,
          };
        }
        if (event.actorId === combat.selfId && !suicide) {
          killStreak += 1;
          audio.killConfirm(killStreak);
          hud.flashHit(true);
          hud.showKillClip(() => clip.export());
          if (killStreak >= 2) hud.showClipSuggestion("multikill ready", () => clip.export());
          hud.dismissHowTo();
          localStorage.setItem("gg:how-to-seen", "1");
        }
      }
      if (event.kind === EventKind.Airshot && event.actorId === combat.selfId) {
        hud.addKillfeed(`AIRSHOT · P${event.targetId}`);
        clip.recordKillfeed(`airshot · p${event.targetId}`);
        hud.showClipSuggestion("airshot ready", () => clip.export());
        audio.airshot();
      }
      if (event.kind === EventKind.Impressive && event.actorId === combat.selfId) {
        hud.showAccolade(event.amount);
        audio.impressive(event.amount);
      }
      if (event.kind === EventKind.NearMiss && event.targetId === combat.selfId) {
        const source = remotes.find((remote) => remote.id === event.actorId)?.position ?? curr.position;
        audio.nearMiss(
          source,
          event.amount / 10,
          (event.flags & EventFlags.HitscanNearMiss) !== 0,
        );
      }
      if (
        event.kind === EventKind.ModeEnd &&
        event.actorId === combat.selfId &&
        event.stats !== undefined
      ) {
        const mapName = mapMesh?.name ?? "map";
        const stats = event.stats;
        const personalBests = updatePersonalBest(localStorage, mapName.toLowerCase(), stats);
        hud.showMatchStats(stats, personalBests, () => {
          void navigator.clipboard.writeText(matchStatsShareText(stats, mapName, location.href));
        });
      }
      if (event.kind === EventKind.SecretTriggered) {
        hud.addKillfeed(`P${event.actorId} found the gg sigil`);
        audio.foundrySigil();
      }
    }
    pipeline.render();
  };
  armRecoverableAnimationLoop(
    (callback) => renderer.setAnimationLoop(callback),
    renderFrame,
    (error) => console.error("renderer frame failed; re-arming animation loop", error),
  );
}

function urlForSelection(selection: MenuSelection): URL {
  const url = new URL(location.href);
  url.searchParams.set("name", selection.name);
  if (selection.create) {
    url.searchParams.delete("room");
    url.searchParams.set("create", "1");
    url.searchParams.set("mode", selection.mode);
    url.searchParams.set("ladder", selection.ladder);
    url.searchParams.set("gravity", selection.gravity);
    url.searchParams.set("map", selection.map);
  } else {
    for (const key of ["create", "mode", "ladder", "gravity", "map"]) url.searchParams.delete(key);
    if (selection.quickplay === true) url.searchParams.delete("room");
  }
  return url;
}

async function startFrontDoor(): Promise<void> {
  root.style.background = "#0e131b";
  const canvas = document.createElement("canvas");
  root.appendChild(canvas);
  showNameEntry(root, (selection) => location.assign(urlForSelection(selection)));
  const query = new URLSearchParams(location.search);
  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: query.get("backend") === "webgl2",
  });
  try {
    await renderer.init();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    const scene = new Scene();
    scene.background = new Color(0x0e131b);
    const camera = new PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 300);
    scene.add(camera);
    const styleId = renderStyleFromQuery(location.search);
    const style = RENDER_STYLES[styleId];
    let mapCenter = { x: 0, y: 0, z: 0 };
    let orbitRadius = 48;
    try {
      const response = await fetch(foundryBlobUrl);
      if (!response.ok) throw new Error(`front-door map load failed: HTTP ${response.status}`);
      const map = loadGameplayMap(await response.arrayBuffer());
      style.fogLightRig(scene);
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(map.collision.positions, 3));
      geometry.setIndex(new BufferAttribute(map.collision.indices, 1));
      geometry.computeVertexNormals();
      scene.add(new Mesh(geometry, style.materials(map).map));
      mapCenter = {
        x: (map.bounds.min.x + map.bounds.max.x) / 2,
        y: 0,
        z: (map.bounds.min.z + map.bounds.max.z) / 2,
      };
      orbitRadius = Math.max(32, Math.hypot(
        map.bounds.max.x - map.bounds.min.x,
        map.bounds.max.z - map.bounds.min.z,
      ) * 0.65);
    } catch (error) {
      console.error(error);
    }
    const resize = (): void => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resize);
    const started = performance.now();
    armRecoverableAnimationLoop((callback) => renderer.setAnimationLoop(callback), () => {
      const angle = ((performance.now() - started) % 60_000) / 60_000 * Math.PI * 2;
      camera.position.set(
        mapCenter.x + Math.sin(angle) * orbitRadius,
        15,
        mapCenter.z + Math.cos(angle) * orbitRadius,
      );
      camera.lookAt(mapCenter.x, 1.5, mapCenter.z);
      renderer.render(scene, camera);
    }, (error) => console.error("front-door world frame failed", error));
  } catch (error) {
    console.error("front-door world unavailable; using fallback background", error);
  }
}

const requestedName = new URLSearchParams(location.search).get("name") ?? "";
if (likelyTouchOnly(navigator, matchMedia("(pointer: coarse)").matches)) {
  showMobileGate(root);
} else if (!validPlayerName(requestedName)) {
  void startFrontDoor();
} else {
  void startGame();
}
