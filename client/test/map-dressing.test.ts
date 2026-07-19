import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { describe, expect, it } from "vitest";

import { MapId } from "../../packages/protocol/src/index.js";
import { MapDressing } from "../src/map-dressing.js";

describe("streamed map dressing", () => {
  it.each([
    MapId.Foundry,
    MapId.Spire,
    MapId.Duna,
    MapId.Cascade,
  ])("installs collision-authored instanced batches for map %s", (mapId) => {
    const scene = new Scene();
    const dressing = new MapDressing(scene, mapId, new MeshBasicNodeMaterial());
    const batches = scene.children.filter((child) =>
      child.name.startsWith("streamed-map-dressing-"));
    expect(batches).toHaveLength(3);
    expect(batches.every((child) => child.userData.collisionSource === "baked-map"))
      .toBe(true);
    dressing.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
