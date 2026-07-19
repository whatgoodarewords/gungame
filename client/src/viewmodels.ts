import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
  type Material,
  type Object3D,
} from "three/webgpu";

import { WeaponId, type WeaponIdValue } from "../../packages/shared/src/index.js";

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

function buildSilhouette(config: ViewmodelConfig, material: Material): Group {
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

export class WeaponViewmodel {
  readonly root = new Group();
  private readonly material: Material;
  private weaponId: WeaponIdValue | undefined;
  private model: Group | undefined;
  private equip = 1;
  private recoil = 0;
  private rack = 0;
  private goldieReload = 0;
  private previousAmmo = 1;

  constructor(material: Material) {
    this.material = material;
    this.root.position.set(0.3, -0.28, -0.62);
    this.root.rotation.set(-0.08, -0.06, 0);
    this.root.layers.set(1);
  }

  setWeapon(weaponId: WeaponIdValue): void {
    if (weaponId === this.weaponId) return;
    this.weaponId = weaponId;
    if (this.model !== undefined) this.root.remove(this.model);
    const config = VIEWMODEL_CONFIGS.find((entry) => entry.weaponId === weaponId);
    if (config === undefined) throw new RangeError(`missing viewmodel for weapon ${weaponId}`);
    this.model = buildSilhouette(config, this.material);
    this.root.add(this.model);
    this.equip = 0;
    this.recoil = 0;
    this.rack = 0;
    this.goldieReload = 0;
  }

  onFire(): void {
    this.recoil = 1;
    if (VIEWMODEL_CONFIGS.find((entry) => entry.weaponId === this.weaponId)?.rack === true) this.rack = 1;
  }

  update(dtSeconds: number, ammo: number, alive: boolean): void {
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
    this.root.visible = alive;
    this.root.position.set(
      0.3 + rackArc * 0.045,
      -0.28 - equipDrop * 0.46 - goldieArc * 0.06,
      -0.62 + this.recoil * 0.13,
    );
    this.root.rotation.set(
      -0.08 + this.recoil * 0.12 + goldieArc * 0.5,
      -0.06 + rackArc * 0.15,
      goldieArc * -0.55,
    );
  }
}
