import { MeshBasicNodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";

import { WeaponId } from "../../packages/shared/src/index.js";
import { VIEWMODEL_CONFIGS, WeaponViewmodel } from "../src/viewmodels.js";

describe("weapon viewmodels", () => {
  it("declares 14 ladder configs covering all 13 unique weapons", () => {
    expect(VIEWMODEL_CONFIGS).toHaveLength(14);
    expect(new Set(VIEWMODEL_CONFIGS.map((config) => config.weaponId)).size).toBe(13);
  });

  it("builds and procedurally animates every weapon without animation assets", () => {
    const viewmodel = new WeaponViewmodel(new MeshBasicNodeMaterial());
    for (const id of Object.values(WeaponId)) {
      viewmodel.setWeapon(id);
      viewmodel.onFire();
      viewmodel.update(1 / 60, id === WeaponId.Goldie ? 0 : 1, true);
      expect(viewmodel.root.children).toHaveLength(1);
      expect(Number.isFinite(viewmodel.root.rotation.x)).toBe(true);
    }
  });
});
