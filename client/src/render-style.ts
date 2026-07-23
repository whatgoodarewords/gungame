import {
  AmbientLight,
  BackSide,
  Color,
  DataTexture,
  DirectionalLight,
  Fog,
  FogExp2,
  Group,
  HemisphereLight,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  MeshToonNodeMaterial,
  NearestFilter,
  RedFormat,
  Scene,
  UnsignedByteType,
  type Material,
  type Node,
} from "three/webgpu";
import {
  color,
  float,
  fract,
  int,
  ivec2,
  mix,
  normalWorld,
  positionWorld,
  screenSize,
  screenUV,
  smoothstep,
  step,
  texture,
  textureLoad,
  vec3,
  vec4,
} from "three/tsl";

import type { GameplayMap } from "../../packages/shared/src/index.js";
import { textureSetForMap, usingBasicMaterialFallback } from "./material-assets.js";

export const RENDER_STYLE_IDS = [
  "high-key",
  "dev-grid",
  "ink-duotone",
  "toon-cel",
  "brutalist-approx",
] as const;

export type RenderStyleId = (typeof RENDER_STYLE_IDS)[number];

export interface RenderPalette {
  readonly background: number;
  readonly surface: number;
  readonly actor: number;
  readonly accent: number;
  readonly ink: number;
}

export interface RenderMaterials {
  readonly map: Material;
  readonly actor: Material;
  readonly projectile: Material;
  readonly viewmodel: Material;
  /** Present for the toon candidate. Main renders it as an inverted hull. */
  readonly outline?: Material;
}

export interface StyleRig {
  readonly root: Group;
  dispose(): void;
}

/**
 * Every aesthetic render decision travels as this one replaceable unit. Values
 * are intentionally placeholders until the Prime commits a candidate.
 */
export interface RenderStyle {
  readonly id: RenderStyleId;
  readonly label: string;
  readonly palette: RenderPalette;
  /**
   * Style provides its full lighting answer from the rig alone — skip the
   * offline HDRI environment (IBL). The genre's high-key register wants flat,
   * readable, deliberately un-cinematic light; the moody industrial HDRIs
   * fight that on every map.
   */
  readonly flatLighting?: boolean;
  materials(map: GameplayMap, mapId?: number): RenderMaterials;
  postChain(source: Node<"vec4">): Node<"vec4">;
  fogLightRig(scene: Scene, map?: GameplayMap): StyleRig;
}

const makeRig = (
  scene: Scene,
  background: number,
  fog: Fog | FogExp2,
  ambient: number,
  sun: number,
  intensity: number,
  map?: GameplayMap,
): StyleRig => {
  scene.background = new Color(background);
  scene.fog = fog;
  const root = new Group();
  root.name = "render-style-rig";
  const safetyFill = new HemisphereLight(0xbfd8ff, 0x17191d, 0.15);
  safetyFill.name = "render-safety-fill";
  root.add(safetyFill);
  root.add(new AmbientLight(ambient, intensity * 0.28));
  const key = new DirectionalLight(sun, intensity);
  key.position.set(28, 54, 18);
  key.castShadow = true;
  const likelyMSeries = typeof navigator !== "undefined" &&
    /Mac/.test(navigator.platform) && navigator.hardwareConcurrency >= 8;
  const shadowSize = likelyMSeries ? 2048 : 1024;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 2.25;
  if (map !== undefined) {
    const extentX = Math.max(18, (map.bounds.max.x - map.bounds.min.x) * 0.55);
    const extentZ = Math.max(18, (map.bounds.max.z - map.bounds.min.z) * 0.55);
    key.shadow.camera.left = -extentX;
    key.shadow.camera.right = extentX;
    key.shadow.camera.top = extentZ;
    key.shadow.camera.bottom = -extentZ;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = Math.max(80, map.bounds.max.y - map.bounds.min.y + 72);
    key.shadow.camera.updateProjectionMatrix();
  }
  root.add(key);
  scene.add(root);
  return {
    root,
    dispose: () => {
      scene.remove(root);
      if (scene.fog === fog) scene.fog = null;
    },
  };
};

const standardMaterials = (palette: RenderPalette, roughness = 0.9): RenderMaterials => {
  const map = new MeshStandardNodeMaterial({ roughness, metalness: 0 });
  map.colorNode = color(palette.surface);
  const actor = new MeshStandardNodeMaterial({ roughness: 0.72 });
  actor.colorNode = color(palette.actor);
  const projectile = new MeshStandardNodeMaterial({ roughness: 0.35 });
  projectile.colorNode = color(palette.accent);
  projectile.emissiveNode = color(palette.accent).mul(0.75);
  const viewmodel = new MeshStandardNodeMaterial({ roughness: 0.55 });
  viewmodel.colorNode = color(palette.accent);
  return { map, actor, projectile, viewmodel };
};

const basicFallbackMaterials = (palette: RenderPalette): RenderMaterials => {
  const map = new MeshBasicNodeMaterial();
  map.colorNode = color(palette.surface);
  const actor = new MeshBasicNodeMaterial();
  actor.colorNode = color(palette.actor);
  const projectile = new MeshBasicNodeMaterial();
  projectile.colorNode = color(palette.accent);
  const viewmodel = new MeshBasicNodeMaterial();
  viewmodel.colorNode = color(palette.accent);
  return { map, actor, projectile, viewmodel };
};

function triplanarMapMaterial(
  palette: RenderPalette,
  mapId?: number,
): MeshStandardNodeMaterial {
  const set = textureSetForMap(mapId);
  const material = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: set.metalness });
  const weightsRaw = normalWorld.abs();
  const weights = weightsRaw.div(weightsRaw.x.add(weightsRaw.y).add(weightsRaw.z).max(0.0001));
  const p = positionWorld.mul(set.scale);
  const sample = (value: typeof set.diffuse) =>
    texture(value, p.yz).rgb.mul(weights.x)
      .add(texture(value, p.xz).rgb.mul(weights.y))
      .add(texture(value, p.xy).rgb.mul(weights.z));
  // CI-eyes round 2: dark vendored albedos (metal plate ≈ near-black steel)
  // made every interior a cave no light could brighten. The palette carries
  // the base brightness; the texture MODULATES it (0.55–1.15) so detail
  // survives without owning the exposure.
  material.colorNode = color(palette.surface).mul(
    sample(set.diffuse).mul(0.6).add(vec3(0.55, 0.55, 0.55)),
  );
  material.roughnessNode = sample(set.roughness).r.mul(0.55).add(0.4);
  material.aoNode = sample(set.ao).r.mul(0.45).add(0.55);
  material.metalnessNode = float(set.metalness);
  return material;
}

function tactilePost(source: Node<"vec4">): Node<"vec4"> {
  const luminance = source.rgb.dot(vec3(0.2126, 0.7152, 0.0722));
  const bloomMask = smoothstep(1.05, 1.8, luminance);
  const bloomed = source.rgb.add(source.rgb.mul(bloomMask).mul(0.12));
  const centered = screenUV.sub(0.5);
  const vignette = float(1).sub(centered.dot(centered).mul(0.16)).clamp(0.91, 1);
  // ACES is applied by RenderPipeline's output transform. Keeping it there
  // avoids feeding a vec3 to ToneMappingNode, whose WebGPU setup reads alpha.
  return vec4(bloomed.mul(vignette), source.a);
}

// ---------------------------------------------------------------------------
// high-key — the genre register (owner pivot 2026-07-20: "heavy ugly Tron").
// Deadshot/Krunker/Venge all read bright, warm, flat-lit, instantly legible.
// Bright day sky, sun with soft grounding shadows, sky/ground hemisphere fill,
// warm light surfaces, saturated readable actors, ZERO post. Speed perception
// lives here too: a bright textured world streaming past gives the motion cues
// a dark low-contrast one swallows.
// ---------------------------------------------------------------------------

const highKeyPalette: RenderPalette = {
  background: 0x9ed2f5,
  surface: 0xd6d0c2,
  actor: 0xe0483e,
  accent: 0xff9042,
  ink: 0x2b3036,
};

const makeDaylightRig = (scene: Scene, map?: GameplayMap): StyleRig => {
  scene.background = new Color(highKeyPalette.background);
  // Haze starts far out: depth cue at range without dimming the play space.
  const fog = new Fog(highKeyPalette.background, 95, 280);
  scene.fog = fog;
  const root = new Group();
  root.name = "render-style-rig";
  const safetyFill = new HemisphereLight(0xbfd8ff, 0x17191d, 0.15);
  safetyFill.name = "render-safety-fill";
  root.add(safetyFill);
  // CI-eyes finding 2026-07-23: enclosed interiors (foundry) rendered as a
  // cave — the sun shadows the whole interior and hemisphere-only fill left
  // nothing unconditional. Daylight = ambient FLOOR first (works on every
  // backend, reaches every interior), hemisphere differential on top for the
  // sky/ground color modeling, sun for shape.
  root.add(new AmbientLight(0xe8f0ff, 0.85));
  const sky = new HemisphereLight(0xcfe6ff, 0xcdb489, 0.8);
  root.add(sky);
  const key = new DirectionalLight(0xfff1d8, 2.0);
  key.position.set(34, 62, 22);
  key.castShadow = true;
  const likelyMSeries = typeof navigator !== "undefined" &&
    /Mac/.test(navigator.platform) && navigator.hardwareConcurrency >= 8;
  const shadowSize = likelyMSeries ? 2048 : 1024;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 2.5;
  if (map !== undefined) {
    const extentX = Math.max(18, (map.bounds.max.x - map.bounds.min.x) * 0.55);
    const extentZ = Math.max(18, (map.bounds.max.z - map.bounds.min.z) * 0.55);
    key.shadow.camera.left = -extentX;
    key.shadow.camera.right = extentX;
    key.shadow.camera.top = extentZ;
    key.shadow.camera.bottom = -extentZ;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = Math.max(80, map.bounds.max.y - map.bounds.min.y + 72);
    key.shadow.camera.updateProjectionMatrix();
  }
  root.add(key);
  scene.add(root);
  return {
    root,
    dispose: () => {
      scene.remove(root);
      if (scene.fog === fog) scene.fog = null;
    },
  };
};

const highKey: RenderStyle = {
  id: "high-key",
  label: "High key",
  palette: highKeyPalette,
  flatLighting: true,
  materials: (_map, mapId) => {
    if (usingBasicMaterialFallback()) return basicFallbackMaterials(highKeyPalette);
    const materials = standardMaterials(highKeyPalette, 0.85);
    // Texture detail stays (motion cues, surface identity) but on a warm light
    // base — and no grid, no emissive accents on the world.
    const map = triplanarMapMaterial(highKeyPalette, mapId);
    return { ...materials, map };
  },
  // Zero post: no vignette, no bloom, no grade. ACES output transform at the
  // pipeline level is the whole answer. Crisp is the feature.
  postChain: (source) => source,
  fogLightRig: makeDaylightRig,
};

const devPalette: RenderPalette = {
  background: 0x071018,
  surface: 0x253846,
  actor: 0xe05c65,
  accent: 0x63d9ff,
  ink: 0x071018,
};

const devGrid: RenderStyle = {
  id: "dev-grid",
  label: "Dev grid",
  palette: devPalette,
  materials: (_map, mapId) => {
    if (usingBasicMaterialFallback()) return basicFallbackMaterials(devPalette);
    const materials = standardMaterials(devPalette, 0.95);
    const map = triplanarMapMaterial(devPalette, mapId);
    const p = positionWorld.mul(0.5);
    const weights = normalWorld.abs();
    const planeXY = fract(p.xy).sub(0.5).abs();
    const planeYZ = fract(p.yz).sub(0.5).abs();
    const planeXZ = fract(p.xz).sub(0.5).abs();
    const lineXY = planeXY.x.max(planeXY.y);
    const lineYZ = planeYZ.x.max(planeYZ.y);
    const lineXZ = planeXZ.x.max(planeXZ.y);
    const edge = lineYZ.mul(weights.x)
      .add(lineXZ.mul(weights.y))
      .add(lineXY.mul(weights.z));
    const grid = step(0.465, edge);
    map.colorNode = mix(color(devPalette.surface), color(devPalette.accent), grid.mul(0.72));
    return { ...materials, map };
  },
  postChain: tactilePost,
  fogLightRig: (scene, map) => makeRig(
    scene,
    devPalette.background,
    new Fog(devPalette.background, 65, 165),
    0x9db4d4,
    0xe9f4ff,
    1.35,
    map,
  ),
};

// An 8x8, rank-complete blue-noise tile. It is sampled in screen space with no
// time input, so a world edge keeps the same threshold from frame to frame.
const BLUE_NOISE_RANKS = Uint8Array.from([
  0, 42, 10, 52, 3, 45, 13, 55,
  32, 18, 60, 26, 35, 21, 63, 29,
  8, 50, 6, 48, 11, 53, 1, 43,
  58, 24, 34, 16, 61, 27, 37, 19,
  2, 44, 12, 54, 5, 47, 15, 57,
  36, 20, 62, 28, 33, 17, 59, 25,
  14, 56, 4, 46, 9, 51, 7, 49,
  40, 22, 38, 30, 41, 23, 39, 31,
].map((rank) => Math.round(rank * 255 / 63)));
const blueNoise = new DataTexture(BLUE_NOISE_RANKS, 8, 8, RedFormat, UnsignedByteType);
blueNoise.minFilter = NearestFilter;
blueNoise.magFilter = NearestFilter;
blueNoise.generateMipmaps = false;
blueNoise.needsUpdate = true;

const inkPalette: RenderPalette = {
  background: 0xe8edf1,
  surface: 0xbac8d2,
  actor: 0x10283a,
  accent: 0x2f72a3,
  ink: 0x07131d,
};

const inkDuotone: RenderStyle = {
  id: "ink-duotone",
  label: "Ink duotone",
  palette: inkPalette,
  materials: (_map, mapId) => {
    if (usingBasicMaterialFallback()) return basicFallbackMaterials(inkPalette);
    const materials = standardMaterials(inkPalette, 1);
    const map = triplanarMapMaterial(inkPalette, mapId);
    return { ...materials, map };
  },
  postChain: (source) => {
    const pixel = screenUV.mul(screenSize).floor();
    const threshold = textureLoad(blueNoise, ivec2(pixel).mod(int(8))).r;
    const luminance = source.rgb.dot(vec3(0.2126, 0.7152, 0.0722));
    const bit = step(threshold, luminance);
    const duotone = mix(color(inkPalette.ink), color(inkPalette.background), bit);
    return vec4(duotone, source.a);
  },
  fogLightRig: (scene, map) => makeRig(
    scene,
    inkPalette.background,
    new Fog(inkPalette.background, 70, 155),
    0xdde7ec,
    0xf8fbff,
    1.15,
    map,
  ),
};

const toonPalette: RenderPalette = {
  background: 0x18213a,
  surface: 0x6d8ac7,
  actor: 0xe65b72,
  accent: 0xffd55e,
  ink: 0x10131d,
};

const toonCel: RenderStyle = {
  id: "toon-cel",
  label: "Toon cel",
  palette: toonPalette,
  materials: (_map) => {
    if (usingBasicMaterialFallback()) return basicFallbackMaterials(toonPalette);
    const map = new MeshToonNodeMaterial();
    map.colorNode = color(toonPalette.surface);
    const actor = new MeshToonNodeMaterial();
    actor.colorNode = color(toonPalette.actor);
    const projectile = new MeshBasicNodeMaterial();
    projectile.colorNode = color(toonPalette.accent);
    const viewmodel = new MeshToonNodeMaterial();
    viewmodel.colorNode = color(toonPalette.accent);
    const outline = new MeshBasicNodeMaterial({ side: BackSide });
    outline.colorNode = color(toonPalette.ink);
    return { map, actor, projectile, viewmodel, outline };
  },
  postChain: (source) => {
    const levels = float(4);
    return vec4(source.rgb.mul(levels).floor().div(levels), source.a);
  },
  fogLightRig: (scene, map) => makeRig(
    scene,
    toonPalette.background,
    new Fog(toonPalette.background, 72, 170),
    0xaec6ff,
    0xfff0bf,
    1.55,
    map,
  ),
};

const brutalistPalette: RenderPalette = {
  background: 0x141719,
  surface: 0x777977,
  actor: 0xc64e3c,
  accent: 0xff6a32,
  ink: 0x111314,
};

const brutalist: RenderStyle = {
  id: "brutalist-approx",
  label: "Brutalist approx",
  palette: brutalistPalette,
  materials: (_map, mapId) => usingBasicMaterialFallback()
    ? basicFallbackMaterials(brutalistPalette)
    : {
      ...standardMaterials(brutalistPalette, 0.98),
      map: triplanarMapMaterial(brutalistPalette, mapId),
    },
  postChain: tactilePost,
  fogLightRig: (scene, map) => makeRig(
    scene,
    brutalistPalette.background,
    new FogExp2(brutalistPalette.background, 0.012),
    0x8e9798,
    brutalistPalette.accent,
    1.05,
    map,
  ),
};

export const RENDER_STYLES: Readonly<Record<RenderStyleId, RenderStyle>> = Object.freeze({
  "high-key": highKey,
  "dev-grid": devGrid,
  "ink-duotone": inkDuotone,
  "toon-cel": toonCel,
  "brutalist-approx": brutalist,
});

export function renderStyleFromQuery(search: string): RenderStyleId {
  const candidate = new URLSearchParams(search).get("style");
  return RENDER_STYLE_IDS.find((id) => id === candidate) ?? "high-key";
}
