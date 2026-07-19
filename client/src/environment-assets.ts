import {
  CubeReflectionMapping,
  RGB_ETC1_Format,
  RGB_ETC2_Format,
  RGB_PVRTC_4BPPV1_Format,
  RGBA_ASTC_4x4_Format,
  RGBA_BPTC_Format,
  RGBA_ETC2_EAC_Format,
  RGBA_PVRTC_4BPPV1_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT5_Format,
  type Scene,
  type Texture,
  type WebGPURenderer,
} from "three/webgpu";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

import cascadeEnvironment from "../../assets/vendor/polyhaven/overcast_industrial_courtyard/overcast_industrial_courtyard_1k_pmrem.ktx2?url";
import dunaEnvironment from "../../assets/vendor/polyhaven/rogland_sunset/rogland_sunset_1k_pmrem.ktx2?url";
import foundryEnvironment from "../../assets/vendor/polyhaven/empty_warehouse_01/empty_warehouse_01_1k_pmrem.ktx2?url";
import spireEnvironment from "../../assets/vendor/polyhaven/industrial_sunset_02_puresky/industrial_sunset_02_puresky_1k_pmrem.ktx2?url";

const ENVIRONMENTS: Readonly<Record<string, string>> = Object.freeze({
  Foundry: foundryEnvironment,
  Spire: spireEnvironment,
  Duna: dunaEnvironment,
  Cascade: cascadeEnvironment,
});

const FORMAT_FEATURE = new Map<number, string>([
  [RGBA_ASTC_4x4_Format, "texture-compression-astc"],
  [RGBA_BPTC_Format, "texture-compression-bc"],
  [RGBA_S3TC_DXT1_Format, "texture-compression-s3tc"],
  [RGBA_S3TC_DXT5_Format, "texture-compression-s3tc"],
  [RGB_ETC1_Format, "texture-compression-etc1"],
  [RGB_ETC2_Format, "texture-compression-etc2"],
  [RGBA_ETC2_EAC_Format, "texture-compression-etc2"],
  [RGB_PVRTC_4BPPV1_Format, "texture-compression-pvrtc"],
  [RGBA_PVRTC_4BPPV1_Format, "texture-compression-pvrtc"],
]);

interface CompressedCubeFace {
  readonly width?: number;
  readonly height?: number;
  readonly mipmaps?: readonly ArrayLike<unknown>[];
}

export function validateEnvironmentTexture(
  renderer: WebGPURenderer,
  texture: Texture,
): void {
  const cube = texture as Texture & {
    readonly format?: number;
    readonly image?: readonly CompressedCubeFace[];
    readonly isCompressedCubeTexture?: boolean;
    readonly isCubeTexture?: boolean;
  };
  if (cube.isCubeTexture !== true || cube.isCompressedCubeTexture !== true) {
    throw new Error("offline environment must decode to a compressed cubemap");
  }
  if (!Array.isArray(cube.image) || cube.image.length !== 6) {
    throw new Error(`offline environment has ${cube.image?.length ?? 0} faces; expected 6`);
  }
  const [first] = cube.image;
  const mipCount = first?.mipmaps?.length ?? 0;
  if (first?.width !== 256 || first.height !== 256 || mipCount !== 9) {
    throw new Error(
      `offline environment layout is ${first?.width ?? 0}x${first?.height ?? 0}/${mipCount} mips; expected 256x256/9`,
    );
  }
  if (cube.image.some((face) =>
    face.width !== first.width || face.height !== first.height ||
    (face.mipmaps?.length ?? 0) !== mipCount)) {
    throw new Error("offline environment cubemap faces have inconsistent dimensions or mip counts");
  }
  const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean };
  const feature = cube.format === undefined ? undefined : FORMAT_FEATURE.get(cube.format);
  if (backend.isWebGPUBackend === true && feature !== undefined && !renderer.hasFeature(feature)) {
    throw new Error(`offline environment format ${cube.format} requires unavailable ${feature}`);
  }
}

export class OfflineEnvironmentAssets {
  private readonly loader: KTX2Loader;
  private readonly renderer: WebGPURenderer;
  private active: Texture | null = null;
  private generation = 0;

  constructor(renderer: WebGPURenderer) {
    this.renderer = renderer;
    this.loader = new KTX2Loader()
      .setTranscoderPath(`${import.meta.env.BASE_URL}basis/`)
      .setWorkerLimit(1);
    this.loader.detectSupport(renderer);
  }

  async install(scene: Scene, mapId: string): Promise<void> {
    const url = ENVIRONMENTS[mapId] ?? ENVIRONMENTS.Foundry!;
    const generation = ++this.generation;
    try {
      const texture = await this.loader.loadAsync(url).catch((error: unknown) => {
        throw new Error(`offline environment KTX2 load failed for ${mapId}`, { cause: error });
      });
      validateEnvironmentTexture(this.renderer, texture);
      this.renderer.initTexture(texture);
      if (generation !== this.generation) {
        texture.dispose();
        return;
      }
      texture.mapping = CubeReflectionMapping;
      texture.userData.offlinePrefilteredMipCount = 9;
      const previous = this.active;
      this.active = texture;
      scene.environment = texture;
      previous?.dispose();
    } catch (error) {
      if (generation === this.generation) {
        scene.environment = null;
        this.active?.dispose();
        this.active = null;
      }
      throw error;
    }
  }

  dispose(): void {
    this.active?.dispose();
    this.loader.dispose();
  }
}
