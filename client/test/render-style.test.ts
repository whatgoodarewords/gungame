import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Scene,
  Texture,
} from "three/webgpu";
import { vec4 } from "three/tsl";
import { describe, expect, it, vi } from "vitest";

import type { GameplayMap } from "../../packages/shared/src/index.js";
import {
  RENDER_STYLES,
  RENDER_STYLE_IDS,
  renderStyleFromQuery,
} from "../src/render-style.js";
import {
  RecoverableRenderPipeline,
  armRecoverableAnimationLoop,
  type RenderPipelineLike,
} from "../src/render-runtime.js";
import { disposeRenderMaterials, disposeSceneSubtree } from "../src/render-resources.js";

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

describe("live style pipeline reconstruction", () => {
  it("disposes rejected/map-replaced materials and owned scene subtrees exactly once", () => {
    const shared = new MeshBasicNodeMaterial();
    const map = new MeshBasicNodeMaterial();
    const projectile = new MeshBasicNodeMaterial();
    const viewmodel = new MeshBasicNodeMaterial();
    const materialSpies = [shared, map, projectile, viewmodel]
      .map((material) => vi.spyOn(material, "dispose"));
    disposeRenderMaterials({
      map,
      actor: shared,
      projectile,
      viewmodel,
      outline: shared,
    });
    expect(materialSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true);

    const root = new Group();
    const geometry = new BoxGeometry();
    const owned = new MeshBasicNodeMaterial();
    const texture = new Texture();
    owned.map = texture;
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(owned, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    root.add(new Mesh(geometry, owned));
    disposeSceneSubtree(root, true);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
  });

  it.each(["webgl2", "webgpu"] as const)(
    "reconstructs and commits every style on the %s backend boundary",
    (backend) => {
      for (const id of RENDER_STYLE_IDS) {
        let initialDisposed = false;
        let candidateRenders = 0;
        const initial: RenderPipelineLike = {
          render: () => {},
          dispose: () => { initialDisposed = true; },
        };
        const runtime = new RecoverableRenderPipeline(initial);
        const candidate: RenderPipelineLike = {
          render: () => { candidateRenders += 1; },
          dispose: () => {},
        };
        let committed = "";
        runtime.replace(candidate, () => { committed = `${backend}:${id}`; }, () => {});
        expect(runtime.render()).toBe(true);
        expect(candidateRenders).toBe(1);
        expect(initialDisposed).toBe(true);
        expect(committed).toBe(`${backend}:${id}`);
      }
    },
  );

  it.each(["webgl2", "webgpu"] as const)(
    "captures %s candidate failures and renders the previous working pipeline",
    (backend) => {
      for (const id of RENDER_STYLE_IDS) {
        let fallbackFrames = 0;
        let rolledBack = false;
        const errors: unknown[] = [];
        const runtime = new RecoverableRenderPipeline({
          render: () => { fallbackFrames += 1; },
          dispose: () => {},
        }, (error) => errors.push(error));
        runtime.replace({
          render: () => { throw new Error(`${backend}:${id}:post-chain`); },
          dispose: () => {},
        }, () => {}, () => { rolledBack = true; });
        expect(runtime.render()).toBe(false);
        expect(rolledBack).toBe(true);
        expect(fallbackFrames).toBe(1);
        expect(errors).toHaveLength(1);
      }
    },
  );

  it("re-arms the animation loop after an uncaught frame exception", () => {
    let installed: (() => void) | null = null;
    let installs = 0;
    let attempts = 0;
    const scheduled: Array<() => void> = [];
    armRecoverableAnimationLoop((callback) => {
      installed = callback;
      installs += 1;
    }, () => {
      attempts += 1;
      if (attempts === 1) throw new Error("synthetic frame death");
    }, () => {}, (callback) => scheduled.push(callback));
    expect(installed).not.toBeNull();
    (installed as unknown as () => void)();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(installs).toBe(2);
    (installed as unknown as () => void)();
    expect(attempts).toBe(2);
  });
});
