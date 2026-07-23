import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Mesh,
  MeshBasicNodeMaterial,
  PCFSoftShadowMap,
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
import { mix, pass, toonOutlinePass, vec4 } from "three/tsl";

import foundryBlobUrl from "../../maps/foundry.blob?url";
import dunaBlobUrl from "../../maps/duna.blob?url";
import cascadeBlobUrl from "../../maps/cascade.blob?url";
import spireBlobUrl from "../../maps/spire.blob?url";
import {
  CLASSIC_LADDER,
  MapSecretKind,
  TICK_DT,
  WEAPONS,
  WeaponId,
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
import { DEFAULT, SCOUTZ, effectiveSpreadDegrees } from "../../packages/sim/src/index.js";
import { GameAudio, type SurfaceMaterial } from "./audio.js";
import { BHOP_ROUTES, BhopTimeTrial } from "./bhop-ghost.js";
import { FpsCamera } from "./camera.js";
import { CameraKick } from "./camera-kick.js";
import { TracerSystem } from "./tracer-system.js";
import { ClipThat } from "./clip-capture.js";
import type {
  ProjectileView,
  ProjectileVisualSystem,
  RemoteCharacterSystem,
} from "./combat-visuals.js";
import type { MapDressing } from "./map-dressing.js";
import type { InterpolatedEntity } from "./net/interpolation.js";
import { MatchHud } from "./hud.js";
import { HudStateMachine } from "./hud-state.js";
import { ImpactVisualSystem } from "./impact-visuals.js";
import { Button, RawInput, rebindControl } from "./input.js";
import { FrameBudgetMeter, LatencyEstimator } from "./perf.js";
import { OfflineEnvironmentAssets } from "./environment-assets.js";
import { installEnvironmentWithFallback } from "./environment-state.js";
import {
  likelyTouchOnly,
  showMobileGate,
  showNameEntry,
  validPlayerName,
  type MenuController,
  type MenuSelection,
} from "./menu.js";
import {
  activateBasicMaterialFallback,
  initializeMaterialAssets,
} from "./material-assets.js";
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
import { disposeRenderMaterials, disposeSceneSubtree } from "./render-resources.js";
import { createPlayground } from "./sim-bridge.js";
import {
  crosshairGapPixels,
  loadUserSettings,
  pingTone,
  saveUserSettings,
  weaponTypeIcon,
  type UserSettings,
} from "./settings.js";
import { PrecisionWeaponViewmodel as WeaponViewmodel } from "./precision-viewmodel.js";
import { VIEWMODEL_CONFIGS, VIEWMODEL_HOLDS, VIEWMODEL_MOTION } from "./viewmodels.js";
import {
  FallbackRenderPipeline,
  RecoverableRenderPipeline,
  armRecoverableAnimationLoop,
  bridgeWebGpuPipelineErrors,
  type RenderPipelineLike,
} from "./render-runtime.js";
import { canonicalRoomUrl, quickplayUrl } from "./room-url.js";
import { surfaceWebSocketClose } from "./net/session.js";
import "./style.css";

// Root-scope service-worker eviction: the host domain's PWA service worker
// (scope "/") intercepts /gg/* navigations and can pin players to a stale
// bundle across quits and hard refreshes — two days of "are you sure it's
// live?" traced to exactly this. The game registers no SW of its own; any
// registration whose scope does not live under /gg is foreign here and gets
// unregistered so the NEXT load always reaches the server.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      if (!new URL(registration.scope).pathname.startsWith("/gg")) {
        void registration.unregister().then((ok) => {
          if (ok) console.warn(`unregistered foreign service worker: ${registration.scope}`);
        });
      }
    }
  }).catch(() => undefined);
}

const RAD2DEG = 180 / Math.PI;
const appRoot = document.querySelector<HTMLDivElement>("#app");
if (appRoot === null) throw new Error("missing #app");
const root: HTMLDivElement = appRoot;
root.dataset.envState = "loading";
root.dataset.lastClose = "none";

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
  const viewmodelCaptureConfig = VIEWMODEL_CONFIGS[Number(query.get("vmconfig"))];
  const viewmodelCaptureKick = query.get("vmkick") === "1";
  const canvas = document.createElement("canvas");
  canvas.style.background = "#24313b";
  root.appendChild(canvas);
  const scene = new Scene();
  const viewmodelScene = new Scene();
  let userSettings: UserSettings = loadUserSettings(localStorage);
  const fpsCam = new FpsCamera(window.innerWidth / window.innerHeight, userSettings.fov);
  const cameraKick = new CameraKick();
  fpsCam.camera.layers.enable(1);
  scene.add(fpsCam.camera);
  const viewmodelCamera = new PerspectiveCamera(
    VIEWMODEL_MOTION.fovDeg,
    window.innerWidth / window.innerHeight,
    VIEWMODEL_MOTION.nearM,
    10,
  );
  viewmodelCamera.layers.set(1);
  viewmodelScene.add(viewmodelCamera);
  const viewmodelLight = new AmbientLight(0xffffff, 1.65);
  // The viewmodel camera renders layer 1 only; a layer-0 light does not
  // illuminate that pass — loaded guns rendered unlit black.
  viewmodelLight.layers.enable(1);
  viewmodelScene.add(viewmodelLight);
  const input = new RawInput(() =>
    canvas.isConnected ? canvas : root.querySelector<HTMLCanvasElement>("canvas:last-of-type") ?? canvas);
  const hud = new MatchHud(root);
  const hudState = new HudStateMachine(true);
  hud.setState(hudState.state);
  const audio = new GameAudio();
  const perf = new FrameBudgetMeter();
  const latency = new LatencyEstimator();
  const impacts = new ImpactVisualSystem(scene);
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

  // Fullscreen-first PLAY (native-feel §2): visible browser chrome is the #1
  // "browser game" tell. Enter fullscreen on the same click gesture that
  // captures the pointer; localStorage opt-out; Esc exits as usual.
  document.addEventListener("pointerdown", (event) => {
    if (localStorage.getItem("gg:fullscreen") === "0") return;
    if (document.fullscreenElement !== null) return;
    const target = event.target;
    if (!(target instanceof HTMLCanvasElement) || target.closest("#app") === null) return;
    void document.documentElement.requestFullscreen({ navigationUI: "hide" })
      .catch(() => undefined);
  });

  // Stale-client watchdog: a long-lived tab (or bfcache resurrection) can run
  // a days-old bundle against a new server forever — old physics, old maps,
  // version-refused joins that read as "stuck at spawn". Poll the server's
  // build and self-update the moment they diverge.
  const watchdogTimer = setInterval(() => {
    void fetch("/gg/healthz", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : undefined)
      .then((health: { buildHash?: string } | undefined) => {
        const serverBuild = health?.buildHash;
        if (serverBuild === undefined || serverBuild === "" || serverBuild === __BUILD_HASH__) {
          sessionStorage.removeItem("gg:stale-reloaded");
          return;
        }
        clearInterval(watchdogTimer);
        // One automatic reload per session — if the mismatch survives a
        // reload something else is wrong and looping would make it worse.
        if (sessionStorage.getItem("gg:stale-reloaded") === serverBuild) return;
        sessionStorage.setItem("gg:stale-reloaded", serverBuild);
        stuckChip.textContent = "new version available — updating…";
        stuckChip.style.display = "block";
        setTimeout(() => location.reload(), 1_200);
      })
      .catch(() => undefined);
  }, 45_000);

  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: query.get("backend") === "webgl2",
    logarithmicDepthBuffer: query.get("backend") === "webgl2",
  });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  try {
    await renderer.init();
  } catch (error) {
    root.style.background = "#24313b";
    const fallbackUrl = new URL(location.href);
    fallbackUrl.searchParams.set("backend", "webgl2");
    hud.showRenderQualityReduced(fallbackUrl.toString());
    console.error("renderer initialization failed after WebGPU/WebGL2 fallback", error);
    throw error;
  }
  const environments = new OfflineEnvironmentAssets(renderer);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  const showConnectionCard = (
    state: "server-restarting" | "version-mismatch" | "room-full" | "room-not-found",
  ): void => {
    if (frontDoor === undefined) {
      frontDoor = showNameEntry(root, (selection) => location.assign(urlForSelection(selection)));
    }
    frontDoor.setConnectionState(state);
  };
  let currentMap: GameplayMap | undefined;
  let currentMapId: number | undefined;
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
  let dressing: MapDressing | undefined;
  let dressingConstructor: (new (
    scene: Scene,
    mapId: number,
    material: Material,
  ) => MapDressing) | undefined;
  let prettyAssetsStarted = false;
  let currentRoomId = "";
  let connectedAtMs = performance.now();
  let networkClosed = false;
  let reconnectScheduled = false;
  let reconnectCountdownTimer: ReturnType<typeof setInterval> | undefined;
  const nameplates = new Map<number, HTMLElement>();
  let panel: DevPanel | undefined;
  const diagnostics: string[] = [];
  const errorMessage = (error: unknown): string =>
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const recordRenderDiagnostic = (
    context: string,
    error: unknown,
    log = true,
  ): void => {
    const message = `${context}: ${errorMessage(error)}`;
    diagnostics.push(message);
    if (diagnostics.length > 8) diagnostics.shift();
    panel?.setDiagnostic(message);
    if (log) console.error(context, error);
  };
  const webgl2FallbackUrl = (): string => {
    const url = new URL(location.href);
    url.searchParams.set("backend", "webgl2");
    return url.toString();
  };
  const showForcedWebGlHint = (): void => {
    hud.showRenderQualityReduced(webgl2FallbackUrl());
  };
  const showNonBlackTerminalFallback = (): void => {
    canvas.style.visibility = "hidden";
    root.style.background = "#24313b";
    showForcedWebGlHint();
  };

  const constructPipeline = (style: typeof currentStyle): FallbackRenderPipeline =>
    new FallbackRenderPipeline([
      {
        label: `${style.id}:full`,
        create: () => {
          const scenePass = style.id === "toon-cel"
            ? toonOutlinePass(scene, fpsCam.camera, new Color(style.palette.ink), 0.0035, 1)
            : pass(scene, fpsCam.camera);
          return new RenderPipeline(renderer, style.postChain(scenePass));
        },
      },
      {
        label: `${style.id}:plain-no-post`,
        create: () => new RenderPipeline(renderer, pass(scene, fpsCam.camera)),
      },
      {
        label: `${style.id}:plain-webgl2-hint`,
        create: (): RenderPipelineLike => {
          const safeMaterial = new MeshBasicNodeMaterial({ color: style.palette.surface });
          return {
            render: () => {
              const previousEnvironment = scene.environment;
              const previousOverride = scene.overrideMaterial;
              scene.environment = null;
              scene.overrideMaterial = safeMaterial;
              try {
                renderer.render(scene, fpsCam.camera);
              } finally {
                scene.overrideMaterial = previousOverride;
                scene.environment = previousEnvironment;
              }
            },
            dispose: () => safeMaterial.dispose(),
          };
        },
      },
    ], (label, error) => {
      recordRenderDiagnostic(`render stage failed (${label})`, error);
    }, (failedLabel, nextLabel) => {
      panel?.setDiagnostic(`fallback ${failedLabel} → ${nextLabel}`);
      if (nextLabel.endsWith(":plain-webgl2-hint")) showForcedWebGlHint();
    });

  rig = currentStyle.fogLightRig(scene, currentMap);
  const pipeline = new RecoverableRenderPipeline(
    constructPipeline(currentStyle),
    (error) => {
      recordRenderDiagnostic("render pipeline recovery exhausted", error);
      showNonBlackTerminalFallback();
    },
  );
  bridgeWebGpuPipelineErrors((error) => {
    if (!pipeline.reportAsyncFailure(error)) showNonBlackTerminalFallback();
  });
  (renderer as unknown as { onError: (info: unknown) => void }).onError = (info): void => {
    const detail = typeof info === "string"
      ? { api: "renderer", type: "error", message: info, originalEvent: undefined }
      : info as {
        api?: string;
        type?: string;
        message?: string;
        originalEvent?: unknown;
      };
    const error = new Error(
      `${detail.api ?? "renderer"} ${detail.type ?? "error"}: ${detail.message ?? "unknown"}`,
      { cause: detail.originalEvent },
    );
    recordRenderDiagnostic("renderer backend error", error);
    if (!pipeline.reportAsyncFailure(error)) showNonBlackTerminalFallback();
  };

  let currentEnvironmentMapName: string | undefined;

  /**
   * Reconcile scene.environment with the active style. Flat-lighting styles
   * (the high-key default) own their full lighting answer, so the offline HDRI
   * is skipped entirely — env state reads "flat", which is a success state, not
   * a fallback. IBL styles (re)install the map's environment as before.
   */
  const installEnvironmentForStyle = (): void => {
    if (currentEnvironmentMapName === undefined) return;
    if (currentStyle.flatLighting === true) {
      scene.environment = null;
      root.dataset.envState = "flat";
      return;
    }
    const environmentMapName = currentEnvironmentMapName;
    void installEnvironmentWithFallback({
      mapName: environmentMapName,
      stateTarget: root,
      install: () => environments.install(scene, environmentMapName),
      activateSafetyMaterials: activateBasicMaterialFallback,
      reapplyStyle: () => applyStyle(currentStyleId),
      recordDiagnostic: recordRenderDiagnostic,
    });
  };

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
    const nextMaterials = currentMap === undefined
      ? undefined
      : nextStyle.materials(currentMap, currentMapId);
    const nextViewmodel = nextMaterials === undefined ? undefined : new WeaponViewmodel(nextMaterials.viewmodel);
    const nextRig = nextStyle.fogLightRig(scene, currentMap);
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
    // Style families disagree about IBL (flat daylight vs HDRI); reconcile now,
    // and again on rollback below once currentStyle is restored.
    installEnvironmentForStyle();
    pipeline.replace(nextPipeline, () => {
      previous.rig?.dispose();
      if (previous.viewmodel !== undefined) {
        fpsCam.camera.remove(previous.viewmodel.root);
        previous.viewmodel.dispose();
      }
      if (previous.materials !== nextMaterials) disposeRenderMaterials(previous.materials);
    }, () => {
      nextRig.dispose();
      if (nextViewmodel !== undefined) {
        fpsCam.camera.remove(nextViewmodel.root);
        nextViewmodel.dispose();
      }
      previous.rig?.dispose();
      rig = previous.style.fogLightRig(scene, currentMap);
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
      if (nextMaterials !== previous.materials) disposeRenderMaterials(nextMaterials);
      installEnvironmentForStyle();
      const url = new URL(location.href);
      url.searchParams.set("style", previous.id);
      history.replaceState(null, "", url);
    });
  };

  void initializeMaterialAssets(renderer).then(() => {
    if (currentMap !== undefined) applyStyle(currentStyleId);
  }).catch((error: unknown) => {
    activateBasicMaterialFallback();
    recordRenderDiagnostic("PBR KTX2 unavailable; basic materials active", error);
    if (currentMap !== undefined) {
      try {
        applyStyle(currentStyleId);
      } catch (fallbackError) {
        recordRenderDiagnostic("basic material fallback application failed", fallbackError);
      }
    }
  });

  const installVisualMap = (
    map: GameplayMap,
    mode: typeof GameMode[keyof typeof GameMode],
    mapId: typeof MapId[keyof typeof MapId],
  ): void => {
    pipeline.cancelPending();
    const previous = {
      materials,
      rig,
      mapMesh,
      ghostMesh,
      raceMarkers,
      viewmodel,
    };
    currentMap = map;
    currentMapId = mapId;
    currentMode = mode;
    clipMapName = mapId === MapId.Spire
      ? "spire"
      : mapId === MapId.Duna
        ? "duna"
        : mapId === MapId.Cascade
          ? "cascade"
          : "foundry";
    audio.setRoomTone(clipMapName);
    timeTrial = new BhopTimeTrial(BHOP_ROUTES[mapId], localStorage);
    if (ghostMesh !== undefined) {
      scene.remove(ghostMesh);
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
    }
    const indexed = new BufferGeometry();
    indexed.setAttribute("position", new BufferAttribute(map.collision.positions, 3));
    indexed.setIndex(new BufferAttribute(map.collision.indices, 1));
    // Face-split before normals: shared-vertex averaging turned every hard
    // architectural edge into mushy blob shading (map-architecture-spec P1).
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    materials = currentStyle.materials(map, mapId);
    characters?.setMaterial(materials.actor);
    projectiles?.setMaterial(materials.projectile);
    mapMesh = new Mesh(geometry, materials.map);
    mapMesh.castShadow = true;
    mapMesh.receiveShadow = true;
    mapMesh.name = mapId === MapId.Spire
      ? "Spire"
      : mapId === MapId.Duna
        ? "Duna"
        : mapId === MapId.Cascade
          ? "Cascade"
          : "Foundry";
    scene.add(mapMesh);
    currentEnvironmentMapName = mapMesh.name;
    installEnvironmentForStyle();
    dressing?.dispose();
    dressing = dressingConstructor === undefined
      ? undefined
      : new dressingConstructor(scene, mapId, materials.map);
    if (viewmodel !== undefined) fpsCam.camera.remove(viewmodel.root);
    viewmodel = new WeaponViewmodel(materials.viewmodel);
    fpsCam.camera.add(viewmodel.root);
    rig = currentStyle.fogLightRig(scene, map);
    previous.rig?.dispose();
    if (previous.ghostMesh !== undefined) disposeSceneSubtree(previous.ghostMesh, true);
    for (const marker of previous.raceMarkers) disposeSceneSubtree(marker, true);
    if (previous.mapMesh !== undefined) disposeSceneSubtree(previous.mapMesh);
    previous.viewmodel?.dispose();
    disposeRenderMaterials(previous.materials);
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
      hud.setReconnectExhausted();
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
      // Canonical room URL: makes the address bar shareable AND lets the
      // reload/reconnect path find its token (review findings 5 + old 8).
      if (roomId !== "") {
        history.replaceState(null, "", canonicalRoomUrl(location.href, roomId));
      }
      connectedAtMs = performance.now();
      networkClosed = false;
      audio.uiConfirm();
      hud.setState(hudState.dispatch({ type: "connected" }));
      frontDoor?.destroy();
      frontDoor = undefined;
      hud.setInviteRoom(roomId);
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
      } else if (code === RefusalCode.InvalidName) {
        // A name the server rejects can never join — a reconnect loop with the
        // same name is a silent stuck-at-spawn. Send the player back to the
        // name screen instead.
        const url = new URL(location.href);
        url.searchParams.delete("name");
        location.assign(url.toString());
      } else {
        hud.setState(hudState.dispatch({ type: "connection-lost" }));
      }
    },
    onClose: (code, reason) => {
      networkClosed = true;
      surfaceWebSocketClose(root, code, reason);
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
  panel = new DevPanel({
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
    inputInspector: () => input.inspector,
    controls: input.controlBindings,
    onControl: (action, code) => {
      input.setBindings(rebindControl(input.controlBindings, action, code));
    },
    settings: userSettings,
    diagnostic: diagnostics.at(-1) ?? "ok",
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
        recordRenderDiagnostic("render style application failed before pipeline activation", error);
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
    const frame = input.peek();
    sim.applyInput({
      buttons: frame.buttons,
      viewYaw: frame.yaw * RAD2DEG,
      viewPitch: frame.pitch * RAD2DEG,
      fireFraction: 0,
    });
    if (!document.hidden) hud.setPointerLock(input.isLocked, false);
  });
  // CI probe input (?ciprobe=1, dev/e2e only): a synthetic input override
  // driving the REAL tick→cmd→server→snapshot path — everything except the
  // pointer-lock DOM layer, which headless browsers cannot grant reliably.
  // This is how CI proves "a player who presses W actually moves" per engine.
  const ciProbeEnabled = query.get("ciprobe") === "1";
  interface CiProbeInput {
    buttons?: number;
    viewYaw?: number;
    viewPitch?: number;
    fire?: boolean;
  }
  sim.setTickInput(() => {
    const probe = ciProbeEnabled
      ? (window as unknown as { __GG_CI_INPUT__?: CiProbeInput }).__GG_CI_INPUT__
      : undefined;
    if (probe !== undefined) {
      return {
        buttons: (probe.buttons ?? 0) | (probe.fire === true ? Button.Fire : 0),
        viewYaw: probe.viewYaw ?? 0,
        viewPitch: probe.viewPitch ?? 0,
        fireFraction: probe.fire === true ? 128 : 0,
      };
    }
    const frame = input.sampleTick();
    return {
      buttons: frame.buttons,
      viewYaw: (frame.fireFraction >= 0 ? frame.firedYaw : frame.yaw) * RAD2DEG,
      viewPitch: (frame.fireFraction >= 0 ? frame.firedPitch : frame.pitch) * RAD2DEG,
      fireFraction: frame.fireFraction >= 0 ? frame.fireFraction : 0,
    };
  });
  hud.setPointerLock(input.isLocked);

  // Pooled ember streaks (combat-juice J4): zero per-shot allocation, visible
  // on the daylight register. Both the local aim tracer and the hit-confirm
  // tracer feed one instanced pool.
  const tracers = new TracerSystem(scene);
  const showTracer = (
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    _headshot: boolean,
    rocket = false,
  ): void => {
    tracers.spawn(from.x, from.y + 1.55, from.z, to.x, to.y + 0.95, to.z);
    impacts.impact(
      to,
      currentMode === GameMode.Scoutzknivez ? 0xb9a98a : 0x8997a1,
      rocket,
    );
  };

  const showAimTracer = (range: number): void => {
    fpsCam.camera.getWorldPosition(aimOrigin);
    fpsCam.camera.getWorldDirection(aimDirection);
    // True wall hit via the sim collision world: debris lands where the
    // bullet lands (owner: 'no debris when it hits the walls').
    aimEnd.copy(aimOrigin).addScaledVector(aimDirection, range);
    const wallHit = sim.getCollisionWorld()?.sweepProjectile(
      { x: aimOrigin.x, y: aimOrigin.y, z: aimOrigin.z },
      { x: aimEnd.x, y: aimEnd.y, z: aimEnd.z },
      0,
    );
    if (wallHit !== undefined) {
      aimEnd.set(wallHit.point.x, wallHit.point.y, wallHit.point.z);
      impacts.impact(
        wallHit.point,
        currentMode === GameMode.Scoutzknivez ? 0xb9a98a : 0x8997a1,
        false,
      );
      audio.playImpact(sim.getCombatState().weaponId, wallHit.point);
    }
    // Start the streak slightly forward/below the eye so it reads as leaving
    // the muzzle, not the forehead.
    aimOrigin.addScaledVector(aimDirection, 0.9);
    aimOrigin.y -= 0.12;
    tracers.spawn(aimOrigin.x, aimOrigin.y, aimOrigin.z, aimEnd.x, aimEnd.y, aimEnd.z);
  };

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    fpsCam.camera.aspect = window.innerWidth / window.innerHeight;
    fpsCam.camera.updateProjectionMatrix();
    viewmodelCamera.aspect = window.innerWidth / window.innerHeight;
    viewmodelCamera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  let wasGrounded = true;
  let lastFrame = performance.now();
  let fpsSmoothed = 0;
  let lastWeapon: WeaponIdValue | undefined;
  let c2pPhotonPending = false;
  // Stuck-diagnostics chip: when the player is spawned but the game is not
  // actually playable, say WHY on screen in plain words. One screenshot of
  // this chip replaces a whole remote-debugging session.
  // Visible build tag: ends every "am I on the new build?" debate in one
  // glance. Doubles as the staleness tell the watchdog can't give old tabs.
  const buildTag = document.createElement("div");
  buildTag.id = "gg-build-tag";
  buildTag.textContent = `build ${__BUILD_HASH__.slice(0, 7)}`;
  buildTag.style.cssText =
    "position:fixed;right:8px;bottom:6px;color:rgba(255,255,255,.38);" +
    "font:10px/1 ui-monospace,monospace;z-index:55;pointer-events:none";
  root.appendChild(buildTag);

  const stuckChip = document.createElement("div");
  stuckChip.id = "gg-stuck-chip";
  stuckChip.style.cssText =
    "position:fixed;left:50%;bottom:18%;transform:translateX(-50%);" +
    "background:rgba(20,22,26,.92);color:#ffd977;font:13px/1.5 ui-monospace,monospace;" +
    "padding:10px 16px;border-radius:6px;z-index:60;display:none;max-width:520px;" +
    "text-align:center;white-space:pre-line";
  root.appendChild(stuckChip);
  let stuckSinceMs = -1;
  let nextStuckCheckMs = 0;
  const updateStuckChip = (now: number, frozen: boolean): void => {
    if (now < nextStuckCheckMs) return;
    nextStuckCheckMs = now + 1_000;
    const combatNow = sim.getCombatState();
    const net = sim.getNetStats();
    const lockState = root.getAttribute("data-lock-state") ?? "never-requested";
    let problem = "";
    if (networkClosed || combatNow.selfId === 0) {
      problem = `not connected — ${root.dataset.lastClose ?? "no close recorded"}\n` +
        "(auto-reconnect is running; if this persists, screenshot this chip)";
    } else if (frozen) {
      problem = "round frozen (scoreboard) — respawns when the next round starts";
    } else if (!input.isLocked) {
      problem = `mouse not captured (lock: ${lockState}) — click the game world`;
    } else if (net.sentCmds > 128 && net.ackedCmdSeq === 0) {
      problem = `server is not processing input (${net.sentCmds} cmds sent, 0 acked)\n` +
        "screenshot this chip — this is the bug";
    }
    if (problem === "") {
      stuckSinceMs = -1;
      stuckChip.style.display = "none";
      return;
    }
    if (stuckSinceMs < 0) stuckSinceMs = now;
    // Grace period so normal transitions (join, brief unlock) never flash it.
    if (now - stuckSinceMs > 3_000) {
      stuckChip.textContent = problem;
      stuckChip.style.display = "block";
    }
  };
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
  const listenerDirection = new Vector3();
  const aimOrigin = new Vector3();
  const aimDirection = new Vector3();
  const aimEnd = new Vector3();
  const nameplateTarget = new Vector3();
  const nameplateDirection = new Vector3();
  const remotePlayers: InterpolatedEntity[] = [];
  const visiblePlayerIds = new Set<number>();
  const projectileList: Array<{
    key: string;
    position: { x: number; y: number; z: number };
    weaponId: number;
  }> = [];
  const projectileKeys = new Map<number, string>();
  const predictedProjectileKeys = new Map<string, string>();
  const visualDebug: Record<string, number | string> = {};
  (window as unknown as { __GG_VISUAL_DEBUG__?: Record<string, number | string> })
    .__GG_VISUAL_DEBUG__ = visualDebug;

  const writeProjectile = (
    index: number,
    key: string,
    position: Readonly<{ x: number; y: number; z: number }>,
    weaponId: number,
  ): void => {
    let value = projectileList[index];
    if (value === undefined) {
      value = { key, position: { x: 0, y: 0, z: 0 }, weaponId };
      projectileList[index] = value;
    }
    value.key = key;
    value.position.x = position.x;
    value.position.y = position.y;
    value.position.z = position.z;
    value.weaponId = weaponId;
  };

  const renderFrame = (): void => {
    const now = performance.now();
    perf.beginFrame(now);
    const dtMs = Math.min(100, now - lastFrame);
    lastFrame = now;
    fpsSmoothed = fpsSmoothed * 0.95 + (1000 / Math.max(dtMs, 0.1)) * 0.05;
    // View angles + held-button peek for camera/HUD only — pulse consumption
    // moved to the sim tick via setTickInput (review finding 7: 144 Hz loss).
    const frame = input.peek();
    // Fire presentation comes from the predicted sim, not wall-clock cadence
    // guessing: exact tick-quantized refire, freeze/empty-Goldie gated, and
    // melee resolves to the knife — the same answers the server will give. (F2)
    const firedWeapons = sim.drainFirePresentations();
    // Click-to-photon (F4). Close a sample only after the frame that actually
    // drew the shot presented — i.e. one rAF later, so the interval includes
    // render+composite+scanout (native-feel §1). `c2pPhotonPending` is set below
    // when a muzzle response draws; closing here at the next rAF approximates
    // that frame's present. Then register any new click for the next shot.
    if (c2pPhotonPending) {
      latency.sampleAtPresent(now);
      c2pPhotonPending = false;
    }
    const fireEventMs = input.takeFireEventMs();
    if (fireEventMs >= 0) latency.markInput(fireEventMs);

    const prev = sim.getPrevState().player;
    const curr = sim.getState().player;
    const combat = sim.getCombatState();
    if (combat.selfId !== 0 && !prettyAssetsStarted) {
      prettyAssetsStarted = true;
      requestAnimationFrame(() => {
        void Promise.all([
          import("./combat-visuals.js"),
          import("./map-dressing.js"),
        ]).then(([visuals, dressingModule]) => {
          if (materials === undefined) return;
          characters ??= new visuals.RemoteCharacterSystem(scene, materials.actor);
          projectiles ??= new visuals.ProjectileVisualSystem(scene, materials.projectile);
          dressingConstructor = dressingModule.MapDressing;
          if (currentMapId !== undefined) {
            dressing?.dispose();
            dressing = new dressingConstructor(scene, currentMapId, materials.map);
          }
        }).catch((error: unknown) => {
          prettyAssetsStarted = false;
          console.warn("deferred character/effect pack unavailable", error);
        });
      });
    }
    const alpha = sim.getAlpha(now);
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
      viewmodel?.onLand();
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
      cameraKick.update(dtMs);
      const ciProbe = ciProbeEnabled
        ? (window as unknown as { __GG_CI_INPUT__?: { viewYaw?: number; viewPitch?: number } }).__GG_CI_INPUT__
        : undefined;
      fpsCam.update(
        px, py, pz,
        ciProbe !== undefined ? (ciProbe.viewYaw ?? 0) / RAD2DEG : input.yaw,
        ciProbe !== undefined ? (ciProbe.viewPitch ?? 0) / RAD2DEG : input.pitch,
        dtMs, duck,
        cameraKick.pitchOffset, cameraKick.yawOffset,
      );
    }
    tracers.update(dtMs, fpsCam.camera);
    audio.setListener(
      fpsCam.camera.position,
      fpsCam.camera.getWorldDirection(listenerDirection),
    );

    const zoomCapable = combat.weaponId === 4 || combat.weaponId === 11;
    const zoomed = zoomCapable && (frame.buttons & Button.Zoom) !== 0 && combat.alive;
    const targetFov = zoomed ? userSettings.fov * 0.45 : userSettings.fov;
    fpsCam.camera.fov += (targetFov - fpsCam.camera.fov) * Math.min(1, dtMs / 80);
    fpsCam.camera.updateProjectionMatrix();
    hud.zoomOverlay.classList.toggle("visible", zoomed);
    // Live-honest bloom: the exact velocity/air-aware cone the server rolls
    // for this state (hybrid meta) — the crosshair teaches stop-to-shoot.
    const liveSpread = effectiveSpreadDegrees(WEAPONS[combat.weaponId], {
      horizontalSpeed: Math.hypot(curr.velocity.x, curr.velocity.z),
      grounded: curr.grounded,
      runSpeed: (currentMode === GameMode.Scoutzknivez ? SCOUTZ : DEFAULT).runSpeed,
      scoped: zoomed,
    });
    hud.setCrosshair(
      userSettings.crosshair,
      crosshairGapPixels(
        userSettings.crosshair,
        WEAPONS[combat.weaponId],
        zoomed,
        window.innerHeight,
        fpsCam.camera.fov,
        liveSpread,
      ),
      zoomed,
      // Amber warning once movement more than doubles the planted cone.
      liveSpread > WEAPONS[combat.weaponId].spreadDegrees * 2 + 0.01,
    );

    const horizontalSpeed = Math.hypot(curr.velocity.x, curr.velocity.z);
    const trial = timeTrial?.update(curr.position, now, combat.alive);
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
    panel?.update(fpsSmoothed, renderer.info.render.drawCalls, perf.snapshot, {
      c2pMedianMs: latency.medianMs,
      c2pP95Ms: latency.p95Ms,
      c2pSamples: latency.sampleCount,
    });
    audio.setWindSpeed(horizontalSpeed);
    const surface: SurfaceMaterial = currentMode === GameMode.Scoutzknivez ? "stone" : "metal";
    if (curr.grounded && horizontalSpeed > 2.2 && now >= nextFootstepMs) {
      audio.footstep(surface, curr.position, true);
      nextFootstepMs = now + Math.max(180, 470 - horizontalSpeed * 10);
    }
    const secretRoom = currentMap?.secrets.find((secret) => secret.kind === MapSecretKind.SpireRoom);
    audio.setSpireSecretAmbience(secretRoom !== undefined && pointInside(curr.position, secretRoom.bounds));

    const displayedWeapon = viewmodelCaptureConfig?.weaponId ?? combat.weaponId;
    if (displayedWeapon !== lastWeapon) {
      const isFirstEquip = lastWeapon === undefined;
      lastWeapon = displayedWeapon;
      viewmodel?.setWeapon(displayedWeapon, viewmodelCaptureConfig);
      // Tier-up is the core loop: the new gun gets a grab+seat sound (J10).
      if (!isFirstEquip) audio.equip();
    }
    if (viewmodelCaptureKick) viewmodel?.onFire();
    // Each predicted-sim fire event presents exactly once. Multiple events in
    // one render frame (SMG at low fps) still present once visually but keep
    // the correct shot count for audio cadence.
    for (const fired of firedWeapons) {
      viewmodel?.onFire();
      cameraKick.fire(fired.weaponId, zoomed, fired.burstIndex);
      audio.playFire(fired.weaponId);
      const rackHold = VIEWMODEL_HOLDS[fired.weaponId];
      if (rackHold.rackMs > 0) {
        const mechanism = fired.weaponId === WeaponId.Scout || fired.weaponId === WeaponId.Deadeye
          ? "bolt"
          : fired.weaponId === WeaponId.Goldie
            ? "slide"
            : "pump";
        audio.rack(rackHold.rackDelayMs / 1_000, rackHold.rackMs, mechanism);
      }
      const weapon = WEAPONS[fired.weaponId];
      if (weapon.kind !== "projectile" && weapon.kind !== "melee") {
        showAimTracer(weapon.range);
        impacts.ejectCasing(fpsCam.camera.position, input.yaw);
      }
      // A real muzzle response drew this frame — arm the click-to-photon close
      // for the next rAF (≈ this frame's present). (F4/S3)
      c2pPhotonPending = true;
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
    remotePlayers.length = 0;
    for (const remote of remotes) {
      if (remote.kind === EntityKind.Player) remotePlayers.push(remote);
    }
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
    const charactersStartedAt = performance.now();
    characters?.update(remotePlayers, now / 1_000);
    visiblePlayerIds.clear();
    for (const remote of remotePlayers) {
      visiblePlayerIds.add(remote.id);
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
      nameplateTarget.set(remote.position.x, remote.position.y + 1.9, remote.position.z);
      nameplateDirection.copy(nameplateTarget).sub(fpsCam.camera.position);
      const distance = nameplateDirection.length();
      let occluded = false;
      if (mapMesh !== undefined && distance < 15) {
        nameplateRaycaster.set(fpsCam.camera.position, nameplateDirection.normalize());
        occluded = (nameplateRaycaster.intersectObject(mapMesh, false)[0]?.distance ?? Infinity) < distance - 0.2;
      }
      const projected = nameplateTarget.project(fpsCam.camera);
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
    perf.mark("characters", performance.now() - charactersStartedAt);

    let projectileCount = 0;
    for (const remote of remotes) {
      if (remote.kind === EntityKind.Projectile) {
        let key = projectileKeys.get(remote.id);
        if (key === undefined) {
          key = `r:${remote.id}`;
          projectileKeys.set(remote.id, key);
        }
        writeProjectile(projectileCount++, key, remote.position, remote.weaponId);
      }
    }
    for (const predicted of combat.predictedProjectiles) {
      let replicated = false;
      for (let index = 0; index < projectileCount; index += 1) {
        const value = projectileList[index]!;
        if (value.weaponId === predicted.weaponId &&
          Math.hypot(
            value.position.x - predicted.position.x,
            value.position.y - predicted.position.y,
            value.position.z - predicted.position.z,
          ) < 0.8) {
          replicated = true;
          break;
        }
      }
      if (!replicated) {
        const identity = `${predicted.ownerId}:${predicted.fireCmdSeq}`;
        let key = predictedProjectileKeys.get(identity);
        if (key === undefined) {
          key = `p:${identity}`;
          predictedProjectileKeys.set(identity, key);
        }
        writeProjectile(projectileCount++, key, predicted.position, predicted.weaponId);
      }
    }
    projectileList.length = projectileCount;
    if (query.get("visualtest") === "1" && projectileCount === 0) {
      writeProjectile(0, "visual-test-rocket", {
        x: curr.position.x + 1.5,
        y: curr.position.y + 1.2,
        z: curr.position.z - 3,
      }, 9);
      projectileList.length = 1;
    }
    const particlesStartedAt = performance.now();
    projectiles?.update(projectileList as readonly ProjectileView[]);
    impacts.update(seconds);
    if (now >= nextWhooshMs) {
      let nearest: (typeof projectileList)[number] | undefined;
      let nearestDistance = Infinity;
      for (const projectile of projectileList) {
        const distance = Math.hypot(
          projectile.position.x - curr.position.x,
          projectile.position.y - curr.position.y,
          projectile.position.z - curr.position.z,
        );
        if (distance < nearestDistance) {
          nearest = projectile;
          nearestDistance = distance;
        }
      }
      if (nearest !== undefined && nearestDistance < 7) {
        audio.projectileWhoosh(nearest.position, nearestDistance);
        nextWhooshMs = now + 180;
      }
    }
    perf.mark("particles", performance.now() - particlesStartedAt);
    const inputDebug = input.inspector;
    visualDebug.projectileMeshes = projectileList.length;
    visualDebug.characterRigs = remotePlayers.length;
    visualDebug.drawCalls = renderer.info.render.drawCalls;
    visualDebug.style = currentStyleId;
    visualDebug.backend = query.get("backend") === "webgl2" ? "webgl2" : "webgpu";
    visualDebug.connected = networkClosed ? 0 : (combat.selfId === 0 ? 0 : 1);
    visualDebug.playerX = curr.position.x;
    visualDebug.playerZ = curr.position.z;
    visualDebug.playerVelocityY = curr.velocity.y;
    visualDebug.playerDucked = curr.ducked ? 1 : 0;
    visualDebug.inputButtons = inputDebug.buttons;
    visualDebug.inputLocked = inputDebug.locked ? 1 : 0;
    visualDebug.inputYaw = input.yaw;
    visualDebug.aimSource = input.aimSource;
    // Scene-state truth for CI eyes: kills whole classes of remote guessing.
    visualDebug.sceneBg = scene.background instanceof Color
      ? scene.background.getHexString()
      : String(scene.background);
    visualDebug.styleId = currentStyleId;
    visualDebug.mapMaterialKind = materials === undefined
      ? "none"
      : (materials.map as { colorNode?: unknown }).colorNode !== undefined
        ? "node-material"
        : "plain";
    visualDebug.rigChildren = rig === undefined
      ? "none"
      : rig.root.children.map((child) => child.type).join(",");
    visualDebug.pipelineStage = pipeline.activeLabel ?? "unknown";
    visualDebug.viewmodelMeshes = (() => {
      let count = 0;
      viewmodel?.root.traverse((node) => {
        if ((node as { isMesh?: boolean }).isMesh === true) count += 1;
      });
      return count;
    })();
    const breakdown = perf.snapshot;
    visualDebug.frameMs = breakdown.frame;
    visualDebug.renderMs = breakdown.render;
    visualDebug.lightingMs = breakdown.lighting;
    visualDebug.postMs = breakdown.post;
    visualDebug.particlesMs = breakdown.particles;
    visualDebug.charactersMs = breakdown.characters;
    visualDebug.frameMedianMs = breakdown.frameMedian;
    visualDebug.frameP99Ms = breakdown.frameP99;
    visualDebug.clickToPhotonMedianMs = latency.medianMs;
    visualDebug.clickToPhotonP95Ms = latency.p95Ms;
    visualDebug.clickToPhotonSamples = latency.sampleCount;
    visualDebug.viewmodelConfig = viewmodelCaptureConfig === undefined
      ? -1
      : VIEWMODEL_CONFIGS.indexOf(viewmodelCaptureConfig);
    visualDebug.viewmodelKick = viewmodelCaptureKick ? 1 : 0;
    visualDebug.inputKeyEvents = inputDebug.keyEvents
      .map((event) => `${event.phase}:${event.code}`)
      .join(",");

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
    updateStuckChip(now, frozen);
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
          showTracer(
            curr.position,
            target.position,
            headshot,
            WEAPONS[event.weaponId as WeaponIdValue]?.kind === "projectile",
          );
          audio.playImpact(event.weaponId as WeaponIdValue, target.position);
          // Ember-confetti hit language (J6): the victim visibly takes the
          // hit, colored to the actor palette so it reads on daylight.
          impacts.hitBurst(target.position, currentStyle.palette.actor, false);
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
        const victim = remotes.find((remote) => remote.id === event.targetId);
        if (victim !== undefined) {
          impacts.hitBurst(victim.position, currentStyle.palette.actor, true);
        } else if (event.targetId === combat.selfId) {
          impacts.hitBurst(curr.position, currentStyle.palette.accent, true);
        }
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
    const renderStartedAt = performance.now();
    pipeline.render();
    perf.mark("render", performance.now() - renderStartedAt);
    perf.endFrame(performance.now());
  };
  armRecoverableAnimationLoop(
    (callback) => renderer.setAnimationLoop(callback),
    renderFrame,
    (error) => console.error("renderer frame failed; re-arming animation loop", error),
  );
}

function urlForSelection(selection: MenuSelection): URL {
  const url = new URL(
    selection.create || selection.quickplay === true
      ? quickplayUrl(location.href)
      : location.href,
  );
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
  canvas.style.background = "#24313b";
  root.appendChild(canvas);
  showNameEntry(root, (selection) => location.assign(urlForSelection(selection)));
  const query = new URLSearchParams(location.search);
  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: query.get("backend") === "webgl2",
  });
  renderer.toneMapping = ACESFilmicToneMapping;
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
      const indexedFrontDoor = new BufferGeometry();
      indexedFrontDoor.setAttribute("position", new BufferAttribute(map.collision.positions, 3));
      indexedFrontDoor.setIndex(new BufferAttribute(map.collision.indices, 1));
      const geometry = indexedFrontDoor.toNonIndexed();
      indexedFrontDoor.dispose();
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
