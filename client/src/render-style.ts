import {
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
  step,
  textureLoad,
  vec3,
  vec4,
} from "three/tsl";

import type { GameplayMap } from "../../packages/shared/src/index.js";

export const RENDER_STYLE_IDS = [
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
  materials(map: GameplayMap): RenderMaterials;
  postChain(source: Node<"vec4">): Node<"vec4">;
  fogLightRig(scene: Scene): StyleRig;
}

const makeRig = (
  scene: Scene,
  background: number,
  fog: Fog | FogExp2,
  sky: number,
  ground: number,
  sun: number,
  intensity: number,
): StyleRig => {
  scene.background = new Color(background);
  scene.fog = fog;
  const root = new Group();
  root.name = "render-style-rig";
  root.add(new HemisphereLight(sky, ground, intensity * 0.55));
  const key = new DirectionalLight(sun, intensity);
  key.position.set(28, 54, 18);
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
  materials: (_map) => {
    const materials = standardMaterials(devPalette, 0.95);
    const map = materials.map as MeshStandardNodeMaterial;
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
  postChain: (source) => source,
  fogLightRig: (scene) => makeRig(
    scene,
    devPalette.background,
    new Fog(devPalette.background, 65, 165),
    0x9db4d4,
    0x20282b,
    0xe9f4ff,
    1.35,
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
  materials: (_map) => {
    const materials = standardMaterials(inkPalette, 1);
    const map = materials.map as MeshStandardNodeMaterial;
    map.colorNode = color(inkPalette.surface);
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
  fogLightRig: (scene) => makeRig(
    scene,
    inkPalette.background,
    new Fog(inkPalette.background, 70, 155),
    0xdde7ec,
    0x8b9aa5,
    0xf8fbff,
    1.15,
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
  fogLightRig: (scene) => makeRig(
    scene,
    toonPalette.background,
    new Fog(toonPalette.background, 72, 170),
    0xaec6ff,
    0x29304a,
    0xfff0bf,
    1.55,
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
  materials: (_map) => standardMaterials(brutalistPalette, 0.98),
  postChain: (source) => source,
  fogLightRig: (scene) => makeRig(
    scene,
    brutalistPalette.background,
    new FogExp2(brutalistPalette.background, 0.012),
    0x8e9798,
    0x222322,
    brutalistPalette.accent,
    1.05,
  ),
};

export const RENDER_STYLES: Readonly<Record<RenderStyleId, RenderStyle>> = Object.freeze({
  "dev-grid": devGrid,
  "ink-duotone": inkDuotone,
  "toon-cel": toonCel,
  "brutalist-approx": brutalist,
});

export function renderStyleFromQuery(search: string): RenderStyleId {
  const candidate = new URLSearchParams(search).get("style");
  return RENDER_STYLE_IDS.find((id) => id === candidate) ?? "dev-grid";
}
