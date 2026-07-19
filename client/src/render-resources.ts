import {
  Texture,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three/webgpu";

import type { RenderMaterials } from "./render-style.js";

function disposeOwnedMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
}

export function disposeRenderMaterials(materials: RenderMaterials | undefined): void {
  if (materials === undefined) return;
  const disposed = new Set<Material>();
  for (const material of Object.values(materials)) {
    if (material === undefined || disposed.has(material)) continue;
    disposed.add(material);
    material.dispose();
  }
}

export function disposeSceneSubtree(root: Object3D, disposeOwnedMaterials = false): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((object) => {
    const mesh = object as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    if (mesh.geometry !== undefined && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    if (!disposeOwnedMaterials || mesh.material === undefined) return;
    const owned = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of owned) {
      if (materials.has(material)) continue;
      materials.add(material);
      disposeOwnedMaterial(material);
    }
  });
}
