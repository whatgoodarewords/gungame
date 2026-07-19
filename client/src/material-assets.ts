import {
  DataTexture,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  type Texture,
  type WebGPURenderer,
} from "three/webgpu";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

import concreteAoUrl from "../../assets/vendor/polyhaven/concrete_floor_worn_001/AO.ktx2?url";
import concreteDiffuseUrl from "../../assets/vendor/polyhaven/concrete_floor_worn_001/Diffuse.ktx2?url";
import concreteRoughUrl from "../../assets/vendor/polyhaven/concrete_floor_worn_001/Rough.ktx2?url";
import metalAoUrl from "../../assets/vendor/polyhaven/metal_plate/AO.ktx2?url";
import metalDiffuseUrl from "../../assets/vendor/polyhaven/metal_plate/Diffuse.ktx2?url";
import metalRoughUrl from "../../assets/vendor/polyhaven/metal_plate/Rough.ktx2?url";
import plasterAoUrl from "../../assets/vendor/polyhaven/plastered_wall_04/AO.ktx2?url";
import plasterDiffuseUrl from "../../assets/vendor/polyhaven/plastered_wall_04/Diffuse.ktx2?url";
import plasterRoughUrl from "../../assets/vendor/polyhaven/plastered_wall_04/Rough.ktx2?url";
import wallAoUrl from "../../assets/vendor/polyhaven/concrete_wall_004/AO.ktx2?url";
import wallDiffuseUrl from "../../assets/vendor/polyhaven/concrete_wall_004/Diffuse.ktx2?url";
import wallRoughUrl from "../../assets/vendor/polyhaven/concrete_wall_004/Rough.ktx2?url";
import { MapId } from "../../packages/protocol/src/index.js";

export interface PbrTextureSet {
  readonly diffuse: Texture;
  readonly roughness: Texture;
  readonly ao: Texture;
  readonly scale: number;
  readonly metalness: number;
}

function configure(value: Texture): Texture {
  value.wrapS = RepeatWrapping;
  value.wrapT = RepeatWrapping;
  return value;
}

const fallback = new DataTexture(
  Uint8Array.of(160, 160, 160, 255),
  1,
  1,
  RGBAFormat,
  UnsignedByteType,
);
fallback.needsUpdate = true;
const fallbackSet: PbrTextureSet = {
  diffuse: fallback,
  roughness: fallback,
  ao: fallback,
  scale: 0.22,
  metalness: 0,
};
let sets: Readonly<Record<"concrete" | "wall" | "metal" | "plaster", PbrTextureSet>> =
  Object.freeze({
    concrete: fallbackSet,
    wall: fallbackSet,
    metal: fallbackSet,
    plaster: fallbackSet,
  });
let basicMaterialFallback = true;

export async function initializeMaterialAssets(renderer: WebGPURenderer): Promise<boolean> {
  const loader = new KTX2Loader()
    .setTranscoderPath(`${import.meta.env.BASE_URL}basis/`)
    .setWorkerLimit(2)
    .detectSupport(renderer);
  try {
    const [
      concreteDiffuse, concreteRoughness, concreteAo,
      wallDiffuse, wallRoughness, wallAo,
      metalDiffuse, metalRoughness, metalAo,
      plasterDiffuse, plasterRoughness, plasterAo,
    ] = await Promise.all([
      loader.loadAsync(concreteDiffuseUrl).catch((error: unknown) => {
        throw new Error("concrete diffuse KTX2 load failed", { cause: error });
      }),
      loader.loadAsync(concreteRoughUrl).catch((error: unknown) => {
        throw new Error("concrete roughness KTX2 load failed", { cause: error });
      }),
      loader.loadAsync(concreteAoUrl).catch((error: unknown) => {
        throw new Error("concrete AO KTX2 load failed", { cause: error });
      }),
      loader.loadAsync(wallDiffuseUrl).catch((error: unknown) => {
        throw new Error("wall diffuse KTX2 load failed", { cause: error });
      }),
      loader.loadAsync(wallRoughUrl).catch((error: unknown) => {
        throw new Error("wall roughness KTX2 load failed", { cause: error });
      }),
      loader.loadAsync(wallAoUrl).catch((error: unknown) => {
        throw new Error("wall AO KTX2 load failed", { cause: error });
      }),
      loader.loadAsync(metalDiffuseUrl).catch((error: unknown) => {
        throw new Error("metal diffuse KTX2 load failed", { cause: error });
      }),
      loader.loadAsync(metalRoughUrl).catch((error: unknown) => {
        throw new Error("metal roughness KTX2 load failed", { cause: error });
      }),
      loader.loadAsync(metalAoUrl).catch((error: unknown) => {
        throw new Error("metal AO KTX2 load failed", { cause: error });
      }),
      loader.loadAsync(plasterDiffuseUrl).catch((error: unknown) => {
        throw new Error("plaster diffuse KTX2 load failed", { cause: error });
      }),
      loader.loadAsync(plasterRoughUrl).catch((error: unknown) => {
        throw new Error("plaster roughness KTX2 load failed", { cause: error });
      }),
      loader.loadAsync(plasterAoUrl).catch((error: unknown) => {
        throw new Error("plaster AO KTX2 load failed", { cause: error });
      }),
    ]);
    sets = Object.freeze({
      concrete: {
        diffuse: configure(concreteDiffuse), roughness: configure(concreteRoughness),
        ao: configure(concreteAo), scale: 0.22, metalness: 0,
      },
      wall: {
        diffuse: configure(wallDiffuse), roughness: configure(wallRoughness),
        ao: configure(wallAo), scale: 0.24, metalness: 0,
      },
      metal: {
        diffuse: configure(metalDiffuse), roughness: configure(metalRoughness),
        ao: configure(metalAo), scale: 0.28, metalness: 0.72,
      },
      plaster: {
        diffuse: configure(plasterDiffuse), roughness: configure(plasterRoughness),
        ao: configure(plasterAo), scale: 0.2, metalness: 0,
      },
    });
    basicMaterialFallback = false;
    return true;
  } catch (error) {
    basicMaterialFallback = true;
    throw error;
  } finally {
    loader.dispose();
  }
}

export function textureSetForMap(mapId?: number): PbrTextureSet {
  if (mapId === MapId.Spire) return sets.plaster;
  if (mapId === MapId.Duna) return sets.wall;
  if (mapId === MapId.Cascade) return sets.concrete;
  return sets.metal;
}

export function activateBasicMaterialFallback(): void {
  basicMaterialFallback = true;
}

export function usingBasicMaterialFallback(): boolean {
  return basicMaterialFallback;
}
