import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createUploadableEnvironmentTexture,
  validateEnvironmentTexture,
} from "../src/environment-assets.js";
import { installEnvironmentWithFallback } from "../src/environment-state.js";

function compressedCube(overrides: Record<string, unknown> = {}): never {
  const faces = Array.from({ length: 6 }, () => ({
    width: 256,
    height: 256,
    mipmaps: Array.from({ length: 9 }, (_, level) => ({
      width: Math.max(1, 256 >> level),
      height: Math.max(1, 256 >> level),
      data: new Uint8Array(16),
    })),
  }));
  return {
    isCubeTexture: true,
    isCompressedCubeTexture: true,
    image: faces,
    ...overrides,
  } as never;
}

describe("offline environment contract", () => {
  const renderer = {
    backend: { isWebGPUBackend: false },
    hasFeature: () => true,
  } as never;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts six consistent 256px faces with the full nine-level chain", () => {
    expect(() => validateEnvironmentTexture(renderer, compressedCube())).not.toThrow();
  });

  it("rejects a face whose decoded mip dimensions drift", () => {
    const texture = compressedCube() as unknown as {
      image: Array<{ mipmaps: Array<{ width: number; height: number }> }>;
    };
    texture.image[4]!.mipmaps[3]!.width = 31;
    expect(() => validateEnvironmentTexture(renderer, texture as never))
      .toThrow("inconsistent dimensions");
  });

  it("normalizes decoded RGBA faces into the cube layout both render backends upload", () => {
    const texture = compressedCube() as unknown as { colorSpace: string };
    texture.colorSpace = "srgb-linear";
    const uploadable = createUploadableEnvironmentTexture(texture as never);

    expect(uploadable.isCubeTexture).toBe(true);
    expect((uploadable as unknown as { isCompressedTexture?: boolean }).isCompressedTexture)
      .not.toBe(true);
    expect(uploadable.images).toHaveLength(6);
    expect(uploadable.mipmaps).toHaveLength(8);
    const baseFaces = uploadable.images as Array<{ image: { width: number; height: number } }>;
    expect(baseFaces[0]!.image).toMatchObject({ width: 256, height: 256 });
    const finalMip = uploadable.mipmaps[7] as { images: Array<{ image: { width: number; height: number } }> };
    expect(finalMip.images[5]!.image).toMatchObject({ width: 1, height: 1 });
    expect(uploadable.userData.offlinePrefilteredMipCount).toBe(9);
  });

  it("contains failures from both install and style fallback without a secondary TypeError", async () => {
    const target = { dataset: {} } as HTMLElement;
    const diagnostics: string[] = [];

    await expect(installEnvironmentWithFallback({
      mapName: "Foundry",
      stateTarget: target,
      install: async () => {
        throw new Error("synthetic decode rejection");
      },
      activateSafetyMaterials: () => {},
      reapplyStyle: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'length')");
      },
      recordDiagnostic: (context, error) => {
        diagnostics.push(`${context}: ${error instanceof Error ? error.message : String(error)}`);
      },
    })).resolves.toBeUndefined();

    expect(target.dataset.envState).toBe("safety");
    expect(diagnostics).toEqual([
      "offline environment unavailable for Foundry; safety lighting active: synthetic decode rejection",
      "environment basic-material fallback failed: Cannot read properties of undefined (reading 'length')",
    ]);
  });

  it("contains a throwing diagnostics sink on the environment fallback path", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const target = { dataset: {} } as HTMLElement;

    await expect(installEnvironmentWithFallback({
      mapName: "Duna",
      stateTarget: target,
      install: async () => { throw new Error("synthetic decode rejection"); },
      activateSafetyMaterials: () => {},
      reapplyStyle: () => {},
      recordDiagnostic: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'length')");
      },
    })).resolves.toBeUndefined();

    expect(target.dataset.envState).toBe("safety");
    expect(consoleError).toHaveBeenCalledWith(
      "environment diagnostic reporting failed",
      expect.objectContaining({ message: "Cannot read properties of undefined (reading 'length')" }),
    );
  });
});
