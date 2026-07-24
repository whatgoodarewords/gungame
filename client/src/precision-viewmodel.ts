import {
  Box3,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  PointLight,
  Vector3,
  type Material,
  type Object3D,
} from "three/webgpu";
import { color } from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneWithSkeleton } from "three/addons/utils/SkeletonUtils.js";

import { WeaponId, type WeaponIdValue } from "../../packages/shared/src/index.js";
import { PREORIENTED_MODEL_URLS, WEAPON_MODEL_URLS, WRAD_ARMS_URL } from "./asset-manifest.js";
import {
  VIEWMODEL_CONFIGS,
  VIEWMODEL_HOLDS,
  VIEWMODEL_MOTION,
  buildSilhouette,
  type ViewmodelConfig,
} from "./viewmodels.js";

// Weapon GLB cache (character-visual-spec P1): one fetch+parse per URL for
// the whole session — the old path refetched and reparsed on EVERY weapon
// switch (every kill in gun game). Cached scenes own their geometry and
// materials; equip clones share them and are never deep-disposed.
const vendoredModelCache = new Map<string, Promise<{ scene: Object3D }>>();

/** First-person target length (meters) per weapon — real-world class scale. */
const WEAPON_VIEW_LENGTH_M: Partial<Record<number, number>> = {
  [WeaponId.Pistol]: 0.30,
  [WeaponId.Smg]: 0.48,
  [WeaponId.Shotgun]: 0.78,
  [WeaponId.Rifle]: 0.80,
  [WeaponId.Scout]: 0.95,
  [WeaponId.Knife]: 0.38,
  [WeaponId.Sidewinder]: 0.32,
  [WeaponId.Boomstick]: 0.82,
  [WeaponId.Deadeye]: 0.92,
  [WeaponId.Goldie]: 0.34,
};

function loadVendoredScene(url: string): Promise<{ scene: Object3D }> {
  let pending = vendoredModelCache.get(url);
  if (pending === undefined) {
    pending = new GLTFLoader().loadAsync(url);
    vendoredModelCache.set(url, pending);
  }
  return pending;
}


export interface PrecisionViewmodelOptions {
  readonly loadAssets?: boolean;
}

function disposeSubtree(root: Object3D, disposeMaterials = false): void {
  const materials = new Set<Material>();
  root.traverse((object) => {
    const mesh = object as {
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

function criticalStep(
  value: number,
  velocity: number,
  target: number,
  dt: number,
  settleSeconds: number,
): readonly [number, number] {
  const omega = 2 / Math.max(0.001, settleSeconds);
  const x = value - target;
  const exponential = Math.exp(-omega * dt);
  const temporary = (velocity + omega * x) * dt;
  return [
    target + (x + temporary) * exponential,
    (velocity - omega * temporary) * exponential,
  ];
}

export class PrecisionWeaponViewmodel {
  readonly root = new Group();
  readonly weaponMount = new Group();
  private readonly material: Material;
  private readonly loadAssets: boolean;
  private readonly proceduralArms: Mesh[] = [];
  private contactShadow: Mesh | undefined;
  private loadedArms: Object3D | undefined;
  private weaponId: WeaponIdValue | undefined;
  private configKey = "";
  private model: Group | undefined;
  private modelIsVendoredClone = false;
  /** True once a real GLB replaced the procedural silhouette (diagnostics). */
  vendoredModelActive = false;
  private leftIk: Object3D | undefined;
  private loadGeneration = 0;
  private disposed = false;
  private equipElapsedMs: number = VIEWMODEL_MOTION.equipMs;
  private recoil = 0;
  private readonly muzzleFlash: Group;
  private readonly muzzleFlashMaterial: MeshBasicNodeMaterial;
  private muzzleFlashAgeMs = 0;
  private shotIndex = 0;
  private rackElapsedMs = Number.POSITIVE_INFINITY;
  private backpushElapsedMs = Number.POSITIVE_INFINITY;
  private landingElapsedMs = Number.POSITIVE_INFINITY;
  private elapsedMs = 0;
  private goldieReload = 0;
  private previousAmmo = 1;
  private swayYaw = 0;
  private swayPitch = 0;
  private swayYawVelocity = 0;
  private swayPitchVelocity = 0;
  private readonly muzzleLight: PointLight;

  constructor(material: Material, options: PrecisionViewmodelOptions = {}) {
    this.material = material;
    this.loadAssets = options.loadAssets ?? true;
    this.root.name = "precision-viewmodel";
    this.root.layers.set(1);
    this.weaponMount.name = "right-hand-weapon-mount";
    this.root.add(this.weaponMount);
    // Constant close-range fill: the rigged guns are near-black flat
    // materials and vanish against dark walls (r22). Radius-limited to the
    // hands so world spill is negligible.
    const handFill = new PointLight(0xfff2e0, 1.1, 1.3, 2);
    handFill.name = "viewmodel-hand-fill";
    handFill.position.set(0.05, 0.15, -0.25);
    this.root.add(handFill);
    this.muzzleLight = new PointLight(0xffb365, 0, 2.4, 2);
    this.muzzleLight.name = "viewmodel-muzzle-flash-light";
    this.muzzleLight.position.set(0, 0.04, -0.62);
    this.weaponMount.add(this.muzzleLight);
    // Visible flash geometry (combat-juice J3): two crossed quads + a center
    // disc in ONE group at the muzzle. Normal alpha blending, NOT additive —
    // additive washes out to nothing against the bright high-key sky.
    const flashMaterial = new MeshBasicNodeMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    });
    flashMaterial.colorNode = color(0xffd977);
    this.muzzleFlashMaterial = flashMaterial;
    const flash = new Group();
    flash.name = "viewmodel-muzzle-flash";
    const petalGeometry = new PlaneGeometry(0.14, 0.14);
    const petalA = new Mesh(petalGeometry, flashMaterial);
    const petalB = new Mesh(petalGeometry, flashMaterial);
    petalB.rotation.z = Math.PI / 2;
    const core = new Mesh(new CircleGeometry(0.05, 10), flashMaterial);
    core.position.z = 0.001;
    flash.add(petalA, petalB, core);
    flash.position.copy(this.muzzleLight.position);
    flash.visible = false;
    flash.traverse((node) => node.layers.set(1));
    this.muzzleFlash = flash;
    this.weaponMount.add(flash);
    this.addProceduralArms();
    this.addContactShadow();
    // WRAD skinned arms DISABLED (CI-eyes r13): the bind-pose skinned rig
    // reparents the weapon mount into its hierarchy and a collapsed skeleton
    // drags the whole first-person layer to garbage transforms (probe: first
    // mesh ~1m ABOVE the eye; r9 showed the giant misshapen arm). Procedural
    // arms + real gun GLBs on clean transforms until the specced bone-pose
    // pass (character-visual-spec P5) lands with screenshot proof.
    // if (this.loadAssets) void this.loadArms();
    this.applyViewmodelLayer();
  }

  /**
   * Layers are per-object, NOT inherited: a layer-1 root with layer-0 child
   * meshes renders NOTHING through the layer-1 viewmodel camera — the gun was
   * invisible on every backend that used the composited pipeline. Enforce
   * recursively at every attach point.
   */
  private applyViewmodelLayer(): void {
    // Single-pass first-person rendering. CI-eyes r12 taxonomy: a standard-
    // material layer-1 camera-child cube with DEFAULT depth flags renders
    // fine, while depthTest=false made the gun vanish outright on the WebGL2
    // node backend. The gun keeps default depth (minor wall-clip possible
    // when hugging geometry — the honest tradeoff until an always-on-top
    // technique is PROVEN on this backend by a screenshot round).
    this.root.traverse((node) => {
      node.layers.set(1);
      node.renderOrder = 999;
    });
  }

  setWeapon(weaponId: WeaponIdValue, requested?: ViewmodelConfig): void {
    const config = requested ??
      VIEWMODEL_CONFIGS.find((entry) => entry.weaponId === weaponId);
    if (config === undefined || config.weaponId !== weaponId) {
      throw new RangeError(`missing viewmodel for weapon ${weaponId}`);
    }
    const configKey = `${config.ladder}:${config.tier}`;
    if (weaponId === this.weaponId && configKey === this.configKey) return;
    this.weaponId = weaponId;
    this.configKey = configKey;
    if (this.model !== undefined) {
      this.model.removeFromParent();
      // Vendored clones share cached geometry/materials — detach only.
      if (!this.modelIsVendoredClone) disposeSubtree(this.model);
    }
    this.modelIsVendoredClone = false;
    this.vendoredModelActive = false;
    this.model = buildSilhouette(config, this.material);
    this.weaponMount.add(this.model);
    this.applyViewmodelLayer();
    const generation = ++this.loadGeneration;
    const url = WEAPON_MODEL_URLS[weaponId];
    if (this.loadAssets && url !== undefined) {
      void this.loadVendoredModel(url, config, generation);
    }
    this.equipElapsedMs = 0;
    this.recoil = 0;
    this.rackElapsedMs = Number.POSITIVE_INFINITY;
    this.backpushElapsedMs = Number.POSITIVE_INFINITY;
    this.goldieReload = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.loadGeneration += 1;
    if (this.loadedArms !== undefined) {
      this.root.add(this.weaponMount);
      this.loadedArms.removeFromParent();
      disposeSubtree(this.loadedArms, true);
      this.loadedArms = undefined;
    }
    if (this.contactShadow !== undefined) {
      this.contactShadow.removeFromParent();
      this.contactShadow.geometry.dispose();
      const material = this.contactShadow.material;
      for (const value of Array.isArray(material) ? material : [material]) value.dispose();
      this.contactShadow = undefined;
    }
    // Detach the vendored-model clone first: it shares geometry/materials
    // with the module cache, and disposeSubtree would destroy them for every
    // future equip.
    this.model?.removeFromParent();
    this.model = undefined;
    disposeSubtree(this.root);
  }

  onFire(): void {
    this.recoil = 1;
    this.rackElapsedMs = 0;
    this.backpushElapsedMs = 0;
    // With the flash quad present the light double-counts at 5.5 (J3).
    this.muzzleLight.intensity = 4.0;
    this.muzzleFlashAgeMs = 0;
    this.muzzleFlash.visible = true;
    this.shotIndex += 1;
    // Deterministic golden-angle roll: never repeats visibly, no RNG.
    this.muzzleFlash.rotation.z = this.shotIndex * 137.5 * (Math.PI / 180);
  }

  onLand(): void {
    this.landingElapsedMs = 0;
  }

  update(
    dtSeconds: number,
    ammo: number,
    alive: boolean,
    viewYawVelocity = 0,
    viewPitchVelocity = 0,
  ): void {
    const dtMs = dtSeconds * 1_000;
    this.elapsedMs += dtMs;
    this.equipElapsedMs = Math.min(VIEWMODEL_MOTION.equipMs, this.equipElapsedMs + dtMs);
    this.recoil *= Math.exp(-dtMs / VIEWMODEL_MOTION.recoilDecayMs);
    this.muzzleLight.intensity *= Math.exp(-dtMs / 18);
    if (this.muzzleFlash.visible) {
      this.muzzleFlashAgeMs += dtMs;
      const life = 1 - this.muzzleFlashAgeMs / 45; // 45 ms = 2-3 frames
      if (life <= 0) {
        this.muzzleFlash.visible = false;
        this.muzzleFlashMaterial.opacity = 0;
      } else {
        this.muzzleFlashMaterial.opacity = 0.9 * life;
      }
    }
    this.rackElapsedMs += dtMs;
    this.backpushElapsedMs += dtMs;
    this.landingElapsedMs += dtMs;
    if (this.weaponId === WeaponId.Goldie && this.previousAmmo === 1 && ammo === 0) {
      this.goldieReload = 1.2;
    }
    this.previousAmmo = ammo;
    if (this.goldieReload > 0) this.goldieReload = Math.max(0, this.goldieReload - dtSeconds);

    const hold = VIEWMODEL_HOLDS[this.weaponId ?? WeaponId.Pistol];
    const equipT = Math.min(1, this.equipElapsedMs / VIEWMODEL_MOTION.equipMs);
    const overshootAt = 0.9;
    const equipAngle = equipT < overshootAt
      ? VIEWMODEL_MOTION.equipStartDeg +
        (-VIEWMODEL_MOTION.equipStartDeg * (1 + VIEWMODEL_MOTION.equipOvershoot)) *
        (1 - (1 - equipT / overshootAt) ** 3)
      : -VIEWMODEL_MOTION.equipStartDeg * VIEWMODEL_MOTION.equipOvershoot *
        (1 - (equipT - overshootAt) / (1 - overshootAt));
    // J10 sequencing: BANG → beat (rackDelayMs) → chk-chk. Concurrent
    // rack+recoil mushed both into one motion.
    const rackT = hold.rackMs === 0
      ? 1
      : Math.min(1, Math.max(0, this.rackElapsedMs - hold.rackDelayMs) / hold.rackMs);
    const rackArc = hold.rackMs === 0 ? 0 : Math.sin(rackT * Math.PI);
    const backpushT = hold.backpushMs === 0
      ? 1
      : Math.min(1, this.backpushElapsedMs / hold.backpushMs);
    const backpush = hold.backpushMs === 0 ? 0 : Math.sin(backpushT * Math.PI);
    const landing = this.landingElapsedMs >= VIEWMODEL_MOTION.landingDipMs
      ? 0
      : Math.sin(this.landingElapsedMs / VIEWMODEL_MOTION.landingDipMs * Math.PI) *
        VIEWMODEL_MOTION.landingDipM;
    const goldiePhase = this.goldieReload / 1.2;
    const goldieArc = Math.sin(goldiePhase * Math.PI);

    const maxSway = VIEWMODEL_MOTION.swayMaxDeg * Math.PI / 180;
    const targetYaw = Math.max(-maxSway, Math.min(maxSway, viewYawVelocity * -0.004));
    const targetPitch = Math.max(-maxSway, Math.min(maxSway, viewPitchVelocity * 0.004));
    [this.swayYaw, this.swayYawVelocity] = criticalStep(
      this.swayYaw,
      this.swayYawVelocity,
      targetYaw,
      dtSeconds,
      VIEWMODEL_MOTION.swayCriticalMs / 1_000,
    );
    [this.swayPitch, this.swayPitchVelocity] = criticalStep(
      this.swayPitch,
      this.swayPitchVelocity,
      targetPitch,
      dtSeconds,
      VIEWMODEL_MOTION.swayCriticalMs / 1_000,
    );
    const idle = Math.sin(this.elapsedMs / VIEWMODEL_MOTION.idlePeriodMs * Math.PI * 2) *
      VIEWMODEL_MOTION.idleAmplitudeM;
    const hum = hold.humShakeM === 0
      ? 0
      : Math.sin(this.elapsedMs * 0.043) * hold.humShakeM;
    const rx = hold.rotationDeg[0] * Math.PI / 180;
    const ry = hold.rotationDeg[1] * Math.PI / 180;
    const rz = hold.rotationDeg[2] * Math.PI / 180;

    this.root.visible = alive;
    // FOV-95 anchor bias: holds were tuned for the retired 54-deg dedicated
    // viewmodel camera; through the main camera the pose sat too low (r14).
    this.root.position.set(
      hold.position[0] - 0.02 + hum,
      hold.position[1] + 0.13 + idle - landing - goldieArc * 0.006,
      hold.position[2] + 0.18 + backpush * hold.backpushM + rackArc * 0.045,
    );
    this.root.rotation.set(
      rx + (equipAngle + this.recoil * hold.kickDeg) * Math.PI / 180 + this.swayPitch,
      ry + this.swayYaw,
      rz + (this.recoil * hold.wristFlickDeg - goldieArc * 8 + rackArc * 4) * Math.PI / 180,
    );
    this.weaponMount.scale.setScalar(hold.scale);
    if (this.leftIk !== undefined) {
      this.leftIk.visible = hold.twoHanded;
      if (hold.twoHanded) this.leftIk.position.set(...hold.foregrip);
    }
  }

  private addProceduralArms(): void {
    // Slimmer, shorter forearms with a dark sleeve tone — the fat full-length
    // orange cylinders read as sausages on the owner's first sighting.
    const armGeometry = new CylinderGeometry(0.045, 0.06, 0.46, 10);
    const left = new Mesh(armGeometry, this.material);
    // Arms sit lower and closer than the gun so their tips frame the grip
    // instead of covering it (contact-sheet round: the pistol hid exactly
    // where the two cylinders converged).
    left.position.set(-0.2, -0.34, 0.04);
    left.rotation.set(1.12, 0.12, -0.18);
    const right = new Mesh(armGeometry, this.material);
    right.position.set(0.2, -0.34, 0.04);
    right.rotation.set(1.12, -0.12, 0.18);
    left.name = "procedural-arm-left";
    right.name = "procedural-arm-right";
    left.layers.set(1);
    right.layers.set(1);
    this.proceduralArms.push(left, right);
    this.root.add(left, right);
  }

  private addContactShadow(): void {
    const shadow = new Mesh(
      new CircleGeometry(0.16, 24),
      new MeshBasicNodeMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    shadow.name = "viewmodel-contact-shadow";
    shadow.position.set(0, -0.12, -0.2);
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(1.8, 0.55, 1);
    shadow.layers.set(1);
    this.contactShadow = shadow;
    this.weaponMount.add(shadow);
  }

  private async loadArms(): Promise<void> {
    try {
      const gltf = await new GLTFLoader().loadAsync(WRAD_ARMS_URL);
      const arms = gltf.scene;
      if (this.disposed) {
        disposeSubtree(arms, true);
        return;
      }
      arms.name = "wrad-arms";
      arms.traverse((object: Object3D) => object.layers.set(1));
      const bounds = new Box3().setFromObject(arms);
      const size = bounds.getSize(new Vector3());
      const center = bounds.getCenter(new Vector3());
      const longest = Math.max(size.x, size.y, size.z, 0.001);
      arms.position.sub(center);
      arms.scale.setScalar(1.25 / longest);
      arms.rotation.set(0, Math.PI, 0);
      this.leftIk = arms.getObjectByName("wrist_ik.l");
      const rightSocket = arms.getObjectByName("socket.r");
      if (rightSocket !== undefined) rightSocket.add(this.weaponMount);
      const proceduralGeometries = new Set(this.proceduralArms.map((arm) => arm.geometry));
      for (const arm of this.proceduralArms) arm.removeFromParent();
      for (const geometry of proceduralGeometries) geometry.dispose();
      this.loadedArms = arms;
      this.root.add(arms);
    } catch (error) {
      console.warn("WRAD arms unavailable; keeping procedural two-arm fallback", error);
    }
  }

  private async loadVendoredModel(
    url: string,
    config: ViewmodelConfig,
    generation: number,
  ): Promise<void> {
    try {
      const gltf = await loadVendoredScene(url);
      if (
        this.disposed ||
        generation !== this.loadGeneration ||
        this.weaponId !== config.weaponId
      ) {
        return; // cache owns the resources; nothing to dispose
      }
      // Clone shares geometry/materials with the cache. KEEP the model's own
      // materials — the old flat-orange overwrite made real models
      // indistinguishable from procedural fallbacks (the #1 'programmer art'
      // tell, character-visual-spec P1).
      // SkeletonUtils.clone, NOT Object3D.clone: the rigged packs are
      // SkinnedMeshes, and a plain clone keeps binding to the ORIGINAL
      // scene's bones — the mesh collapses to bind space at the world origin
      // (CI r24: vmRealGunLoaded=1, twelve meshes, zero gun pixels; the
      // contact sheet renders because it uses gltf.scene directly).
      const model = cloneWithSkeleton(gltf.scene);
      model.traverse((object: Object3D) => {
        object.layers.set(1);
        // Skinned viewmodel meshes: bounds live in bind space — culling
        // desyncs from the posed mesh (gun-asset-report gotcha).
        if ((object as { isSkinnedMesh?: boolean }).isSkinnedMesh === true) {
          (object as { frustumCulled: boolean }).frustumCulled = false;
        }
      });
      if (PREORIENTED_MODEL_URLS.has(url)) {
        // Rigged flat-guns pack: real meters, -Z forward, grip origin —
        // recentering or scaling would break bone space. Load verbatim.
      } else {
        const bounds = new Box3().setFromObject(model);
        const size = bounds.getSize(new Vector3());
        const center = bounds.getCenter(new Vector3());
        const longest = Math.max(size.x, size.y, size.z, 0.001);
        // Normalize legacy merged-mesh models to a per-class REAL length.
        model.position.sub(center);
        model.scale.setScalar((WEAPON_VIEW_LENGTH_M[config.weaponId] ?? 0.6) / longest);
        model.rotation.set(0, Math.PI, 0);
      }
      const composed = new Group();
      composed.add(model);
      const previous = this.model;
      previous?.removeFromParent();
      // The silhouette being replaced is procedural (disposable); the clone
      // going in shares cache resources (never deep-disposed).
      if (previous !== undefined && !this.modelIsVendoredClone) disposeSubtree(previous);
      this.modelIsVendoredClone = true;
      this.vendoredModelActive = true;
      this.model = composed;
      this.weaponMount.add(composed);
      this.applyViewmodelLayer();
    } catch (error) {
      console.warn(`viewmodel asset unavailable; keeping procedural ${config.silhouette}`, error);
    }
  }
}
