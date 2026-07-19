import { Scene } from "three/webgpu";
import { vec4 } from "three/tsl";
import { describe, expect, it } from "vitest";

import type { GameplayMap } from "../../packages/shared/src/index.js";
import {
  RENDER_STYLES,
  RENDER_STYLE_IDS,
  renderStyleFromQuery,
} from "../src/render-style.js";

const map: GameplayMap = {
  collision: { positions: new Float32Array(), indices: new Uint32Array() },
  spawns: [],
  bounds: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
  killVolumes: [],
  secrets: [],
};

describe("RenderStyle bake-off harness", () => {
  it("constructs every material, TSL post graph, palette, and fog/light rig", () => {
    expect(RENDER_STYLE_IDS).toHaveLength(4);
    for (const id of RENDER_STYLE_IDS) {
      const style = RENDER_STYLES[id];
      const materials = style.materials(map);
      expect(materials.map).toBeDefined();
      expect(materials.actor).toBeDefined();
      expect(materials.projectile).toBeDefined();
      expect(materials.viewmodel).toBeDefined();
      expect(style.postChain(vec4(0.25, 0.5, 0.75, 1))).toBeDefined();
      expect(Object.values(style.palette).every(Number.isFinite)).toBe(true);
      const scene = new Scene();
      const rig = style.fogLightRig(scene);
      expect(scene.children).toContain(rig.root);
      rig.dispose();
      expect(scene.children).not.toContain(rig.root);
    }
  });

  it("selects valid query styles and safely defaults invalid values", () => {
    expect(renderStyleFromQuery("?style=toon-cel")).toBe("toon-cel");
    expect(renderStyleFromQuery("?style=unknown")).toBe("dev-grid");
  });
});
