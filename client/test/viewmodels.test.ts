import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
} from "three/webgpu";
import { describe, expect, it, vi } from "vitest";

import { WeaponId } from "../../packages/shared/src/index.js";
import { PrecisionWeaponViewmodel } from "../src/precision-viewmodel.js";
import {
  VIEWMODEL_CONFIGS,
  VIEWMODEL_HOLDS,
  VIEWMODEL_MOTION,
  WeaponViewmodel,
} from "../src/viewmodels.js";

describe("weapon viewmodels", () => {
  it("declares 14 ladder configs covering all 13 unique weapons", () => {
    expect(VIEWMODEL_CONFIGS).toHaveLength(14);
    expect(new Set(VIEWMODEL_CONFIGS.map((config) => config.weaponId)).size).toBe(13);
  });

  it("keeps the owner hold contract in one complete dial table", () => {
    expect(Object.keys(VIEWMODEL_HOLDS)).toHaveLength(13);
    expect(VIEWMODEL_MOTION).toMatchObject({
      fovDeg: 54,
      nearM: 0.01,
      maxFrameHeight: 0.22,
      parallelOffsetDeg: -2,
      swayMaxDeg: 1.2,
      landingDipM: 0.006,
      landingDipMs: 60,
      recoilDecayMs: 80,
      equipMs: 140,
      equipStartDeg: -22,
      equipOvershoot: 0.1,
      idleAmplitudeM: 0.002,
      idlePeriodMs: 3_000,
    });
    expect(VIEWMODEL_HOLDS[WeaponId.Boomstick]).toMatchObject({
      kickDeg: 5,
      rackMs: 240, // J10: a pump you can't see is a pump you don't have
      rackDelayMs: 140,
      twoHanded: true,
    });
    expect(VIEWMODEL_HOLDS[WeaponId.Arc].humShakeM).toBe(0.0003);
    expect(VIEWMODEL_HOLDS[WeaponId.Peacemaker]).toMatchObject({
      kickDeg: 4,
      backpushMs: 40,
    });
    expect(VIEWMODEL_HOLDS[WeaponId.Goldie].kickDeg).toBe(2.2);
  });

  it("builds and procedurally animates every weapon without animation assets", () => {
    const viewmodel = new PrecisionWeaponViewmodel(
      new MeshBasicNodeMaterial(),
      { loadAssets: false },
    );
    for (const id of Object.values(WeaponId)) {
      viewmodel.setWeapon(id);
      viewmodel.onFire();
      viewmodel.update(1 / 60, id === WeaponId.Goldie ? 0 : 1, true);
      expect(viewmodel.root.children.length).toBeGreaterThanOrEqual(3);
      expect(Number.isFinite(viewmodel.root.rotation.x)).toBe(true);
    }
  });

  it("disposes the procedural silhouette when a vendored model replaces it", async () => {
    let resolveLoad!: (model: Group) => void;
    const loaded = new Promise<Group>((resolve) => { resolveLoad = resolve; });
    const viewmodel = new WeaponViewmodel(new MeshBasicNodeMaterial(), {
      loadModel: () => loaded,
    });
    viewmodel.setWeapon(WeaponId.Pistol);
    const silhouette = viewmodel.root.children.find((child) => child instanceof Group);
    if (silhouette === undefined) throw new Error("procedural silhouette missing");
    const disposals: Array<ReturnType<typeof vi.spyOn>> = [];
    silhouette.traverse((object) => {
      if (object instanceof Mesh) disposals.push(vi.spyOn(object.geometry, "dispose"));
    });

    resolveLoad(new Group());
    await loaded;
    await Promise.resolve();

    expect(disposals.length).toBeGreaterThan(0);
    expect(disposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it("invalidates and disposes an in-flight vendored load on viewmodel disposal", async () => {
    let resolveLoad!: (model: Group) => void;
    const pending = new Promise<Group>((resolve) => { resolveLoad = resolve; });
    const viewmodel = new WeaponViewmodel(new MeshBasicNodeMaterial(), {
      loadModel: () => pending,
    });
    viewmodel.setWeapon(WeaponId.Pistol);
    viewmodel.dispose();
    const loadedGeometry = new BoxGeometry();
    const loadedMaterial = new MeshBasicNodeMaterial();
    const geometryDispose = vi.spyOn(loadedGeometry, "dispose");
    const materialDispose = vi.spyOn(loadedMaterial, "dispose");
    const loaded = new Group();
    loaded.add(new Mesh(loadedGeometry, loadedMaterial));

    resolveLoad(loaded);
    await pending;
    await Promise.resolve();

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(viewmodel.root.children).not.toContain(loaded);
  });
});
