import {
  CubeReflectionMapping,
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

export class OfflineEnvironmentAssets {
  private readonly loader: KTX2Loader;
  private active: Texture | null = null;
  private generation = 0;

  constructor(renderer: WebGPURenderer) {
    this.loader = new KTX2Loader()
      .setTranscoderPath("/basis/")
      .setWorkerLimit(1);
    this.loader.detectSupport(renderer);
  }

  async install(scene: Scene, mapId: string): Promise<void> {
    const url = ENVIRONMENTS[mapId] ?? ENVIRONMENTS.Foundry!;
    const generation = ++this.generation;
    const texture = await this.loader.loadAsync(url);
    if (generation !== this.generation) {
      texture.dispose();
      return;
    }
    texture.mapping = CubeReflectionMapping;
    const previous = this.active;
    this.active = texture;
    scene.environment = texture;
    previous?.dispose();
  }

  dispose(): void {
    this.active?.dispose();
    this.loader.dispose();
  }
}
