import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  Color,
  Line,
  LineBasicMaterial,
  Mesh,
  PerspectiveCamera,
  RenderPipeline,
  Scene,
  SphereGeometry,
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
import { FpsCamera } from "./camera.js";
import { MatchHud } from "./hud.js";
import { HudStateMachine } from "./hud-state.js";
import { Button, RawInput } from "./input.js";
import { showNameEntry, validPlayerName, type MenuController, type MenuSelection } from "./menu.js";
import { DevPanel } from "./panel.js";
import {
  RENDER_STYLES,
  RENDER_STYLE_IDS,
  renderStyleFromQuery,
  type RenderMaterials,
  type RenderStyleId,
  type StyleRig,
} from "./render-style.js";
import { createPlayground } from "./sim-bridge.js";
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
  const fpsCam = new FpsCamera(window.innerWidth / window.innerHeight);
  fpsCam.camera.layers.enable(1);
  scene.add(fpsCam.camera);
  const input = new RawInput(canvas);
  const hud = new MatchHud(root);
  const hudState = new HudStateMachine(true);
  hud.setState(hudState.state);
  const audio = new GameAudio();
  canvas.addEventListener("pointerdown", () => audio.unlock(), { once: true });

  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: query.get("backend") === "webgl2",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  await renderer.init();
  const showConnectionCard = (state: "server-restarting" | "version-mismatch" | "room-full"): void => {
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
  let viewmodel: WeaponViewmodel | undefined;
  const remoteMeshes = new Map<number, Mesh>();
  const projectileMeshes = new Map<string, Mesh>();

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
      for (const mesh of remoteMeshes.values()) if (nextMaterials !== undefined) mesh.material = nextMaterials.actor;
      for (const mesh of projectileMeshes.values()) if (nextMaterials !== undefined) mesh.material = nextMaterials.projectile;
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
      for (const mesh of remoteMeshes.values()) if (previous.materials !== undefined) mesh.material = previous.materials.actor;
      for (const mesh of projectileMeshes.values()) if (previous.materials !== undefined) {
        mesh.material = previous.materials.projectile;
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
    if (mapMesh !== undefined) {
      scene.remove(mapMesh);
      mapMesh.geometry.dispose();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(map.collision.positions, 3));
    geometry.setIndex(new BufferAttribute(map.collision.indices, 1));
    geometry.computeVertexNormals();
    materials = currentStyle.materials(map);
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

  const { sim } = createPlayground(canvas, {
    mapUrlForMode,
    mapUrlForMap,
    onMapLoaded: installVisualMap,
    onWelcome: (_mode, _variant, _ladder, _mapId, roomId) => {
      hud.setState(hudState.dispatch({ type: "connected" }));
      frontDoor?.destroy();
      frontDoor = undefined;
      if (query.get("create") === "1") hud.showInvite(roomId);
    },
    onRefusal: (code) => {
      if (code === RefusalCode.VersionMismatch) {
        showConnectionCard("version-mismatch");
        hud.setState(hudState.dispatch({ type: "version-mismatch" }));
      } else if (code === RefusalCode.ServerRestarting) {
        showConnectionCard("server-restarting");
        hud.setState(hudState.dispatch({ type: "server-restarting" }));
      } else if (code === RefusalCode.RoomFull) {
        showConnectionCard("room-full");
      } else {
        hud.setState(hudState.dispatch({ type: "connection-lost" }));
      }
    },
    onClose: (code, reason) => {
      const restarting = code === 1012 || reason.toLowerCase().includes("restart");
      if (restarting) showConnectionCard("server-restarting");
      hud.setState(hudState.dispatch({ type: restarting ? "server-restarting" : "connection-lost" }));
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
      SCOUTZ: { ...SCOUTZ, jumpBufferMs: 80 },
      DEFAULT: { ...DEFAULT, jumpBufferMs: 80 },
    },
    onPreset: (name) => {
      Object.assign(params, name === "SCOUTZ" ? SCOUTZ : DEFAULT);
      sim.setParams(params);
    },
    onSensitivity: (cm360, dpi) => input.setSensitivity(cm360, dpi),
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
  });

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
      scene.remove(tracer, impact);
      geometry.dispose();
    }, 90);
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
    fpsCam.update(px, py, pz, input.yaw, input.pitch, dtMs, duck);

    const zoomCapable = combat.weaponId === 4 || combat.weaponId === 11;
    const zoomed = zoomCapable && (frame.buttons & Button.Zoom) !== 0 && combat.alive;
    fpsCam.camera.fov += ((zoomed ? 45 : 100) - fpsCam.camera.fov) * Math.min(1, dtMs / 80);
    fpsCam.camera.updateProjectionMatrix();
    hud.zoomOverlay.classList.toggle("visible", zoomed);

    const horizontalSpeed = Math.hypot(curr.velocity.x, curr.velocity.z);
    panel.update(fpsSmoothed, renderer.info.render.drawCalls);
    audio.setWindSpeed(horizontalSpeed);
    const surface: SurfaceMaterial = currentMode === GameMode.Scoutzknivez ? "stone" : "metal";
    if (curr.grounded && horizontalSpeed > 2.2 && now >= nextFootstepMs) {
      audio.footstep(surface);
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
      nextLocalShotMs = now + WEAPONS[combat.weaponId].refireTicks * TICK_DT * 1_000;
    }
    viewmodel?.update(dtMs / 1_000, combat.ammo, combat.alive);

    const remotes = sim.getRemotePlayers(now);
    const visiblePlayers = new Set<number>();
    for (const remote of remotes) {
      if (remote.kind !== EntityKind.Player) continue;
      visiblePlayers.add(remote.id);
      let mesh = remoteMeshes.get(remote.id);
      if (mesh === undefined && materials !== undefined) {
        mesh = new Mesh(new BoxGeometry(0.8, 1.8, 0.8), materials.actor);
        remoteMeshes.set(remote.id, mesh);
        scene.add(mesh);
      }
      if (mesh !== undefined) {
        mesh.position.set(remote.position.x, remote.position.y + 0.9, remote.position.z);
        mesh.visible = remote.alive;
      }
    }
    for (const [id, mesh] of remoteMeshes) if (!visiblePlayers.has(id)) mesh.visible = false;

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
    for (const [key, projectile] of projectileViews) {
      let mesh = projectileMeshes.get(key);
      if (mesh === undefined && materials !== undefined) {
        mesh = new Mesh(new SphereGeometry(projectile.weaponId === 9 ? 0.16 : 0.11, 8, 6), materials.projectile);
        projectileMeshes.set(key, mesh);
        scene.add(mesh);
      }
      mesh?.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
    }
    for (const [key, mesh] of projectileMeshes) {
      if (!projectileViews.has(key)) {
        scene.remove(mesh);
        projectileMeshes.delete(key);
      }
    }

    const mode = combat.modeState;
    const ladderLength = mode === undefined ? CLASSIC_LADDER.length : ladderWeapons(mode.ladder).length;
    hud.setStatus({
      health: combat.health,
      tier: combat.tier,
      ladderLength,
      weapon: WEAPONS[combat.weaponId].displayName,
      ...(WEAPONS[combat.weaponId].magazine === 0 ? {} : { ammo: [combat.ammo, WEAPONS[combat.weaponId].magazine] as const }),
      speed: horizontalSpeed,
    });
    const frozen = mode?.roundState === RoundState.ScoreboardFreeze;
    hud.setState(hudState.dispatch({ type: "snapshot", alive: combat.alive, frozen }));
    if (mode !== undefined) {
      const heading = mode.mode === GameMode.Scoutzknivez
        ? `${mode.teamScores[0]} — ${mode.teamScores[1]}`
        : mode.winnerId === 0 ? "" : `P${mode.winnerId} wins`;
      hud.setScoreboard(mode.scoreboard, scoreboardHeld, mode.roundState, heading);
    }

    for (const event of sim.drainCombatEvents()) {
      const headshot = (event.flags & EventFlags.Headshot) !== 0;
      if (event.kind === EventKind.HitConfirm && event.actorId === combat.selfId) {
        hud.hitmarker.classList.add("visible");
        hud.damageNumber.textContent = String(event.amount);
        hud.damageNumber.classList.add("visible");
        audio.hitmarker(event.amount);
        if (headshot) audio.headshot();
        const target = remotes.find((remote) => remote.id === event.targetId);
        if (target !== undefined) {
          showTracer(curr.position, target.position, headshot);
          audio.playImpact(event.weaponId as WeaponIdValue, target.position);
        }
        setTimeout(() => {
          hud.hitmarker.classList.remove("visible");
          hud.damageNumber.classList.remove("visible");
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
        hud.addKillfeed(suicide
          ? `P${event.targetId} suicide`
          : `P${event.actorId} → P${event.targetId}${headshot ? " [HEAD]" : ""}`);
        if (event.actorId === combat.selfId && !suicide) audio.killConfirm();
      }
      if (event.kind === EventKind.Airshot && event.actorId === combat.selfId) {
        hud.addKillfeed(`AIRSHOT · P${event.targetId}`);
        audio.airshot();
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
if (!validPlayerName(requestedName)) void startFrontDoor();
else void startGame();
