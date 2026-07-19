import {
  Box3,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
  type Object3D,
} from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { WeaponId, type WeaponIdValue } from "../../packages/shared/src/index.js";
import { WEAPON_MODEL_URLS, WRAD_ARMS_URL } from "./asset-manifest.js";

type Silhouette = "pistol" | "smg" | "shotgun" | "rifle" | "scout" | "knife" |
  "arc" | "launcher" | "discus";

export interface ViewmodelConfig {
  readonly ladder: "classic" | "arsenal";
  readonly tier: number;
  readonly weaponId: WeaponIdValue;
  readonly silhouette: Silhouette;
  readonly scale: readonly [number, number, number];
  readonly rack: boolean;
}

export interface ViewmodelHold {
  readonly anchorNdc: readonly [number, number];
  readonly position: readonly [number, number, number];
  readonly rotationDeg: readonly [number, number, number];
  readonly scale: number;
  readonly foregrip: readonly [number, number, number];
  readonly kickDeg: number;
  readonly backpushM: number;
  readonly backpushMs: number;
  readonly rackMs: number;
  readonly wristFlickDeg: number;
  readonly humShakeM: number;
  readonly twoHanded: boolean;
}

const hold = (
  position: readonly [number, number, number],
  rotationDeg: readonly [number, number, number],
  scale: number,
  foregrip: readonly [number, number, number],
  kickDeg: number,
  twoHanded: boolean,
  extras: Partial<Pick<ViewmodelHold,
    "backpushM" | "backpushMs" | "rackMs" | "wristFlickDeg" | "humShakeM">> = {},
): ViewmodelHold => Object.freeze({
  anchorNdc: [0.28, -0.32] as const,
  position,
  rotationDeg,
  scale,
  foregrip,
  kickDeg,
  backpushM: extras.backpushM ?? 0,
  backpushMs: extras.backpushMs ?? 0,
  rackMs: extras.rackMs ?? 0,
  wristFlickDeg: extras.wristFlickDeg ?? 0,
  humShakeM: extras.humShakeM ?? 0,
  twoHanded,
});

/** The complete owner-facing hold dial surface. */
export const VIEWMODEL_HOLDS: Readonly<Record<WeaponIdValue, ViewmodelHold>> = Object.freeze({
  [WeaponId.Pistol]: hold([0.285, -0.315, -0.72], [-3.5, -2, -1], 0.82,
    [-0.19, -0.04, -0.32], 1.8, false),
  [WeaponId.Smg]: hold([0.29, -0.325, -0.78], [-3, -2, -1], 0.78,
    [-0.2, -0.02, -0.42], 1.4, true),
  [WeaponId.Shotgun]: hold([0.29, -0.335, -0.82], [-3, -2, -1], 0.72,
    [-0.21, -0.015, -0.55], 5, true, { rackMs: 90 }),
  [WeaponId.Rifle]: hold([0.29, -0.325, -0.82], [-3, -2, -1], 0.7,
    [-0.2, -0.01, -0.58], 2.1, true),
  [WeaponId.Scout]: hold([0.285, -0.33, -0.86], [-3.2, -2, -1], 0.66,
    [-0.19, 0, -0.64], 3.2, true, { rackMs: 90 }),
  [WeaponId.Knife]: hold([0.31, -0.35, -0.7], [-4, -2, 7], 0.82,
    [-0.16, -0.04, -0.3], 6, false, { wristFlickDeg: 6 }),
  [WeaponId.Sidewinder]: hold([0.285, -0.315, -0.72], [-3.5, -2, -1], 0.8,
    [-0.18, -0.04, -0.32], 1.8, false),
  [WeaponId.Boomstick]: hold([0.29, -0.335, -0.82], [-3, -2, -1], 0.7,
    [-0.21, -0.015, -0.56], 5, true, { rackMs: 90 }),
  [WeaponId.Arc]: hold([0.29, -0.325, -0.76], [-3, -2, -1], 0.76,
    [-0.2, -0.015, -0.46], 0, true, { humShakeM: 0.0003 }),
  [WeaponId.Peacemaker]: hold([0.29, -0.34, -0.82], [-3, -2, -1], 0.7,
    [-0.21, -0.01, -0.56], 4, true, { backpushM: 0.04, backpushMs: 40 }),
  [WeaponId.Discus]: hold([0.3, -0.33, -0.74], [-3.5, -2, 2], 0.77,
    [-0.18, -0.02, -0.4], 2.5, true, { wristFlickDeg: 2.5 }),
  [WeaponId.Deadeye]: hold([0.285, -0.33, -0.86], [-3.2, -2, -1], 0.65,
    [-0.19, 0, -0.64], 3.2, true, { rackMs: 90 }),
  [WeaponId.Goldie]: hold([0.285, -0.32, -0.72], [-3.5, -2, -1], 0.8,
    [-0.18, -0.04, -0.32], 2.2, false),
});

export const VIEWMODEL_MOTION = Object.freeze({
  fovDeg: 54,
  nearM: 0.01,
  maxFrameHeight: 0.22,
  parallelOffsetDeg: -2,
  swayMaxDeg: 1.2,
  swayCriticalMs: 80,
  landingDipM: 0.006,
  landingDipMs: 60,
  recoilDecayMs: 80,
  equipMs: 140,
  equipStartDeg: -15,
  equipOvershoot: 0.1,
  idleAmplitudeM: 0.002,
  idlePeriodMs: 3_000,
});

/** Fourteen ladder configurations; shared silhouettes are explicit, never accidental. */
export const VIEWMODEL_CONFIGS: readonly ViewmodelConfig[] = Object.freeze([
  { ladder: "classic", tier: 1, weaponId: WeaponId.Pistol, silhouette: "pistol", scale: [1, 1, 1], rack: false },
  { ladder: "classic", tier: 2, weaponId: WeaponId.Smg, silhouette: "smg", scale: [1, 1, 1], rack: false },
  { ladder: "classic", tier: 3, weaponId: WeaponId.Shotgun, silhouette: "shotgun", scale: [1, 1, 1], rack: true },
  { ladder: "classic", tier: 4, weaponId: WeaponId.Rifle, silhouette: "rifle", scale: [1, 1, 1], rack: false },
  { ladder: "classic", tier: 5, weaponId: WeaponId.Scout, silhouette: "scout", scale: [1, 1, 1], rack: true },
  { ladder: "classic", tier: 6, weaponId: WeaponId.Knife, silhouette: "knife", scale: [1, 1, 1], rack: false },
  { ladder: "arsenal", tier: 1, weaponId: WeaponId.Sidewinder, silhouette: "pistol", scale: [1.12, 1.05, 1.18], rack: false },
  { ladder: "arsenal", tier: 2, weaponId: WeaponId.Boomstick, silhouette: "shotgun", scale: [1.08, 1.15, 1.12], rack: true },
  { ladder: "arsenal", tier: 3, weaponId: WeaponId.Arc, silhouette: "arc", scale: [1, 1, 1], rack: false },
  { ladder: "arsenal", tier: 4, weaponId: WeaponId.Peacemaker, silhouette: "launcher", scale: [1, 1, 1], rack: false },
  { ladder: "arsenal", tier: 5, weaponId: WeaponId.Discus, silhouette: "discus", scale: [1, 1, 1], rack: false },
  { ladder: "arsenal", tier: 6, weaponId: WeaponId.Deadeye, silhouette: "scout", scale: [0.95, 1, 1.08], rack: true },
  { ladder: "arsenal", tier: 7, weaponId: WeaponId.Goldie, silhouette: "pistol", scale: [0.9, 0.92, 1.08], rack: true },
  { ladder: "arsenal", tier: 8, weaponId: WeaponId.Knife, silhouette: "knife", scale: [1.08, 1.08, 1.08], rack: false },
]);

function part(
  parent: Group,
  geometry: ConstructorParameters<typeof Mesh>[0],
  material: Material,
  position: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

export function buildSilhouette(config: ViewmodelConfig, material: Material): Group {
  const root = new Group();
  const body = new Group();
  root.add(body);
  switch (config.silhouette) {
    case "pistol":
      part(body, new BoxGeometry(0.16, 0.16, 0.58), material, [0, 0, -0.22]);
      part(body, new BoxGeometry(0.12, 0.34, 0.14), material, [0, -0.2, -0.04], [0.18, 0, 0]);
      part(body, new CylinderGeometry(0.035, 0.035, 0.36, 8), material, [0, 0.015, -0.62], [Math.PI / 2, 0, 0]);
      if (config.weaponId === WeaponId.Goldie) {
        part(body, new TorusGeometry(0.11, 0.025, 5, 10), material, [0, -0.02, -0.18], [Math.PI / 2, 0, 0]);
      }
      break;
    case "smg":
    case "rifle": {
      const long = config.silhouette === "rifle" ? 0.9 : 0.68;
      part(body, new BoxGeometry(0.19, 0.22, long), material, [0, 0, -0.35]);
      part(body, new BoxGeometry(0.12, 0.3, 0.18), material, [0, -0.22, -0.18], [0.2, 0, 0]);
      part(body, new BoxGeometry(0.13, 0.18, 0.32), material, [0, -0.04, 0.18]);
      break;
    }
    case "shotgun":
      part(body, new BoxGeometry(0.24, 0.2, 0.72), material, [0, 0, -0.25]);
      part(body, new CylinderGeometry(0.045, 0.045, 0.92, 8), material, [-0.06, 0.05, -0.72], [Math.PI / 2, 0, 0]);
      part(body, new CylinderGeometry(0.045, 0.045, 0.92, 8), material, [0.06, 0.05, -0.72], [Math.PI / 2, 0, 0]);
      part(body, new BoxGeometry(0.18, 0.18, 0.3), material, [0, -0.18, -0.12], [0.2, 0, 0]);
      break;
    case "scout":
      part(body, new BoxGeometry(0.17, 0.2, 1.05), material, [0, 0, -0.45]);
      part(body, new CylinderGeometry(0.07, 0.07, 0.42, 10), material, [0, 0.17, -0.38], [Math.PI / 2, 0, 0]);
      part(body, new BoxGeometry(0.13, 0.3, 0.17), material, [0, -0.2, -0.16], [0.15, 0, 0]);
      break;
    case "knife":
      part(body, new BoxGeometry(0.09, 0.1, 0.38), material, [0, -0.08, 0]);
      part(body, new ConeGeometry(0.105, 0.72, 4), material, [0, 0, -0.52], [Math.PI / 2, 0, 0]);
      break;
    case "arc":
      part(body, new CylinderGeometry(0.16, 0.22, 0.72, 8), material, [0, 0, -0.25], [Math.PI / 2, 0, 0]);
      part(body, new TorusGeometry(0.2, 0.035, 6, 12), material, [0, 0, -0.55], [Math.PI / 2, 0, 0]);
      part(body, new SphereGeometry(0.12, 8, 6), material, [0, 0.08, -0.24]);
      break;
    case "launcher":
      part(body, new CylinderGeometry(0.18, 0.23, 0.9, 10), material, [0, 0, -0.4], [Math.PI / 2, 0, 0]);
      part(body, new BoxGeometry(0.16, 0.32, 0.18), material, [0, -0.23, -0.1], [0.15, 0, 0]);
      break;
    case "discus":
      part(body, new TorusGeometry(0.26, 0.07, 8, 18), material, [0, 0, -0.35], [Math.PI / 2, 0, 0]);
      part(body, new CylinderGeometry(0.17, 0.17, 0.09, 18), material, [0, 0, -0.35], [Math.PI / 2, 0, 0]);
      part(body, new BoxGeometry(0.12, 0.27, 0.2), material, [0, -0.2, -0.12]);
      break;
  }
  root.scale.set(...config.scale);
  root.traverse((object: Object3D) => {
    object.layers.set(1);
  });
  return root;
}

const RECOIL_PROFILES: Readonly<Record<WeaponIdValue, readonly [number, number]>> = Object.freeze({
  [WeaponId.Pistol]: [0.12, 0.13],
  [WeaponId.Smg]: [0.07, 0.08],
  [WeaponId.Shotgun]: [0.18, 0.2],
  [WeaponId.Rifle]: [0.1, 0.11],
  [WeaponId.Scout]: [0.2, 0.18],
  [WeaponId.Knife]: [0.08, 0.04],
  [WeaponId.Sidewinder]: [0.14, 0.14],
  [WeaponId.Boomstick]: [0.24, 0.23],
  [WeaponId.Arc]: [0.025, 0.035],
  [WeaponId.Peacemaker]: [0.2, 0.21],
  [WeaponId.Discus]: [0.11, 0.1],
  [WeaponId.Deadeye]: [0.22, 0.19],
  [WeaponId.Goldie]: [0.28, 0.24],
});

export interface WeaponViewmodelOptions {
  readonly loadAssets?: boolean;
  readonly loadModel?: (url: string) => Promise<Group>;
}

function disposeSubtree(
  root: { traverse(cb: (o: unknown) => void): void },
  disposeMaterials = false,
): void {
  const materials = new Set<Material>();
  root.traverse((obj) => {
    const mesh = obj as {
      geometry?: { dispose(): void };
      isMesh?: boolean;
      material?: Material | Material[];
    };
    if (mesh.isMesh !== true) return;
    mesh.geometry?.dispose();
    if (!disposeMaterials || mesh.material === undefined) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (materials.has(material)) continue;
      materials.add(material);
      material.dispose();
    }
  });
}

export class WeaponViewmodel {
  readonly root = new Group();
  private readonly material: Material;
  private readonly loadAssets: boolean;
  private readonly loadModel: (url: string) => Promise<Group>;
  private weaponId: WeaponIdValue | undefined;
  private model: Group | undefined;
  private loadGeneration = 0;
  private disposed = false;
  private equip = 1;
  private recoil = 0;
  private rack = 0;
  private goldieReload = 0;
  private previousAmmo = 1;
  private swayYaw = 0;
  private swayPitch = 0;

  constructor(material: Material, options: WeaponViewmodelOptions = {}) {
    this.material = material;
    this.loadAssets = options.loadAssets ?? true;
    this.loadModel = options.loadModel ?? (async (url) => (await new GLTFLoader().loadAsync(url)).scene);
    this.root.position.set(0.3, -0.28, -0.62);
    this.root.rotation.set(-0.08, -0.06, 0);
    this.root.layers.set(1);
    this.addProceduralArms();
  }

  setWeapon(weaponId: WeaponIdValue): void {
    if (weaponId === this.weaponId) return;
    this.weaponId = weaponId;
    if (this.model !== undefined) {
      this.root.remove(this.model);
      disposeSubtree(this.model);
    }
    const config = VIEWMODEL_CONFIGS.find((entry) => entry.weaponId === weaponId);
    if (config === undefined) throw new RangeError(`missing viewmodel for weapon ${weaponId}`);
    this.model = buildSilhouette(config, this.material);
    this.root.add(this.model);
    const generation = ++this.loadGeneration;
    const url = WEAPON_MODEL_URLS[weaponId];
    if (this.loadAssets && url !== undefined) {
      void this.loadVendoredModel(url, config, generation);
    }
    this.equip = 0;
    this.recoil = 0;
    this.rack = 0;
    this.goldieReload = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.loadGeneration += 1;
    disposeSubtree(this.root);
    this.model = undefined;
  }

  onFire(): void {
    this.recoil = 1;
    if (VIEWMODEL_CONFIGS.find((entry) => entry.weaponId === this.weaponId)?.rack === true) this.rack = 1;
  }

  update(
    dtSeconds: number,
    ammo: number,
    alive: boolean,
    viewYawVelocity = 0,
    viewPitchVelocity = 0,
  ): void {
    this.equip = Math.min(1, this.equip + dtSeconds * 6.5);
    this.recoil = Math.max(0, this.recoil - dtSeconds * 9);
    this.rack = Math.max(0, this.rack - dtSeconds * 2.8);
    if (this.weaponId === WeaponId.Goldie && this.previousAmmo === 1 && ammo === 0) this.goldieReload = 1.2;
    this.previousAmmo = ammo;
    if (this.goldieReload > 0) this.goldieReload = Math.max(0, this.goldieReload - dtSeconds);
    const equipDrop = (1 - this.equip) ** 2;
    const rackArc = Math.sin(this.rack * Math.PI);
    const goldiePhase = this.goldieReload / 1.2;
    const goldieArc = Math.sin(goldiePhase * Math.PI);
    const swayBlend = Math.min(1, dtSeconds * 12);
    this.swayYaw += (Math.max(-1, Math.min(1, viewYawVelocity * -0.018)) - this.swayYaw) * swayBlend;
    this.swayPitch +=
      (Math.max(-1, Math.min(1, viewPitchVelocity * 0.014)) - this.swayPitch) * swayBlend;
    const [recoilPitch, recoilKick] =
      RECOIL_PROFILES[this.weaponId ?? WeaponId.Pistol];
    this.root.visible = alive;
    this.root.position.set(
      0.3 + rackArc * 0.045 + this.swayYaw * 0.045,
      -0.28 - equipDrop * 0.46 - goldieArc * 0.06 + this.swayPitch * 0.035,
      -0.62 + this.recoil * recoilKick,
    );
    this.root.rotation.set(
      -0.08 + this.recoil * recoilPitch + goldieArc * 0.5 + this.swayPitch * 0.055,
      -0.06 + rackArc * 0.15 + this.swayYaw * 0.07,
      goldieArc * -0.55 + this.swayYaw * -0.035,
    );
  }

  private addProceduralArms(): void {
    const armGeometry = new CylinderGeometry(0.075, 0.1, 0.72, 8);
    const left = new Mesh(armGeometry, this.material);
    left.position.set(-0.2, -0.3, -0.05);
    left.rotation.set(1.12, 0.12, -0.18);
    const right = new Mesh(armGeometry, this.material);
    right.position.set(0.2, -0.3, -0.05);
    right.rotation.set(1.12, -0.12, 0.18);
    left.name = "procedural-arm-left";
    right.name = "procedural-arm-right";
    left.layers.set(1);
    right.layers.set(1);
    this.root.add(left, right);
  }

  private async loadVendoredModel(
    url: string,
    config: ViewmodelConfig,
    generation: number,
  ): Promise<void> {
    try {
      const loaded = await this.loadModel(url);
      if (
        this.disposed ||
        generation !== this.loadGeneration ||
        this.weaponId !== config.weaponId
      ) {
        disposeSubtree(loaded, true);
        return;
      }
      const model = loaded;
      model.traverse((object: Object3D) => {
        object.layers.set(1);
        if (object instanceof Mesh) object.material = this.material;
      });
      const bounds = new Box3().setFromObject(model);
      const size = bounds.getSize(new Vector3());
      const center = bounds.getCenter(new Vector3());
      const longest = Math.max(size.x, size.y, size.z, 0.001);
      model.position.sub(center);
      model.scale.setScalar(0.95 / longest);
      model.rotation.set(0, Math.PI, 0);
      const composed = new Group();
      composed.add(model);
      composed.scale.set(...config.scale);
      const previous = this.model;
      previous?.removeFromParent();
      if (previous !== undefined) disposeSubtree(previous);
      this.model = composed;
      this.root.add(composed);
    } catch (error) {
      console.warn(`viewmodel asset unavailable; keeping procedural ${config.silhouette}`, error);
    }
  }
}
