import { basename, dirname, join } from "node:path";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const ENVIRONMENT_HDRI = Object.freeze([
  "polyhaven/empty_warehouse_01/empty_warehouse_01_1k.hdr",
  "polyhaven/industrial_sunset_02_puresky/industrial_sunset_02_puresky_1k.hdr",
  "polyhaven/rogland_sunset/rogland_sunset_1k.hdr",
  "polyhaven/overcast_industrial_courtyard/overcast_industrial_courtyard_1k.hdr",
]);

export const ENVIRONMENT_FORMAT =
  "KTX2 Basis UASTC LDR cubemap, 256px, six faces, nine explicit linear roughness mips";

const KTX2_IDENTIFIER = Buffer.from([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const KHR_DF_MODEL_UASTC = 166;
const KHR_DF_TRANSFER_LINEAR = 1;
const LEVEL_INDEX_OFFSET = 80;
const LEVEL_INDEX_ENTRY_BYTES = 24;

export function environmentOutputPath(root, relativeHdri) {
  const source = join(root, "assets/vendor", relativeHdri);
  return join(dirname(source), `${basename(source, ".hdr")}_pmrem.ktx2`);
}

export function validateOfflineEnvironmentKtx2(bytes, label = "offline environment") {
  if (
    bytes.length < LEVEL_INDEX_OFFSET + 9 * LEVEL_INDEX_ENTRY_BYTES ||
    !bytes.subarray(0, KTX2_IDENTIFIER.length).equals(KTX2_IDENTIFIER)
  ) {
    throw new Error(`${label}: invalid KTX2 identifier or truncated header`);
  }
  const header = {
    vkFormat: bytes.readUInt32LE(12),
    typeSize: bytes.readUInt32LE(16),
    width: bytes.readUInt32LE(20),
    height: bytes.readUInt32LE(24),
    depth: bytes.readUInt32LE(28),
    layers: bytes.readUInt32LE(32),
    faces: bytes.readUInt32LE(36),
    levels: bytes.readUInt32LE(40),
    supercompression: bytes.readUInt32LE(44),
    dfdOffset: bytes.readUInt32LE(48),
    dfdLength: bytes.readUInt32LE(52),
  };
  if (
    header.vkFormat !== 0 || header.typeSize !== 1 ||
    header.width !== 256 || header.height !== 256 ||
    header.depth !== 0 || header.layers !== 0 ||
    header.faces !== 6 || header.levels !== 9 ||
    header.supercompression !== 0
  ) {
    throw new Error(
      `${label}: expected UASTC 256x256 cubemap/9 mips; got ` +
      `vk=${header.vkFormat} ${header.width}x${header.height} ` +
      `depth=${header.depth} layers=${header.layers} faces=${header.faces} ` +
      `levels=${header.levels} supercompression=${header.supercompression}`,
    );
  }
  if (
    header.dfdLength < 16 ||
    header.dfdOffset + header.dfdLength > bytes.length ||
    bytes[header.dfdOffset + 12] !== KHR_DF_MODEL_UASTC ||
    bytes[header.dfdOffset + 13] !== KHR_DF_TRANSFER_LINEAR
  ) {
    throw new Error(`${label}: DFD must declare linear Basis UASTC`);
  }

  const levels = [];
  for (let level = 0; level < header.levels; level += 1) {
    const entry = LEVEL_INDEX_OFFSET + level * LEVEL_INDEX_ENTRY_BYTES;
    const offset = Number(bytes.readBigUInt64LE(entry));
    const byteLength = Number(bytes.readBigUInt64LE(entry + 8));
    const uncompressedByteLength = Number(bytes.readBigUInt64LE(entry + 16));
    const dimension = Math.max(1, header.width >> level);
    const expectedBytes = Math.max(1, Math.ceil(dimension / 4)) ** 2 * 16 * header.faces;
    if (
      !Number.isSafeInteger(offset) || !Number.isSafeInteger(byteLength) ||
      offset % 8 !== 0 || offset < LEVEL_INDEX_OFFSET + header.levels * LEVEL_INDEX_ENTRY_BYTES ||
      offset + byteLength > bytes.length ||
      byteLength !== expectedBytes || uncompressedByteLength !== expectedBytes
    ) {
      throw new Error(
        `${label}: mip ${level} is inconsistent: ${dimension}x${dimension}, ` +
        `offset=${offset}, bytes=${byteLength}/${uncompressedByteLength}, expected=${expectedBytes}`,
      );
    }
    levels.push({ level, dimension, byteLength });
  }
  return Object.freeze({ ...header, levels: Object.freeze(levels) });
}

/**
 * Load the same Basis transcoder build shipped to browsers. The generated
 * wrapper is CommonJS, but lives below a `type: module` package boundary, so
 * evaluate it in an isolated CommonJS context instead of relying on Node's
 * filename-based module classification.
 */
export async function loadShippedBasisTranscoder(root) {
  const scriptPath = join(root, "client/public/basis/basis_transcoder.js");
  const wasmPath = join(root, "client/public/basis/basis_transcoder.wasm");
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: createRequire(scriptPath),
    __filename: scriptPath,
    __dirname: dirname(scriptPath),
    process,
    console,
    WebAssembly,
    Promise,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  if (typeof module.exports !== "function") {
    throw new Error("shipped Basis transcoder wrapper did not export a factory");
  }
  const basis = await module.exports({ wasmBinary: readFileSync(wasmPath) });
  basis.initializeBasis();
  return basis;
}

/**
 * Exercise the browser's actual KTX2 decode boundary. Header validation alone
 * cannot prove that Basis sees six cube faces, consistent original mip sizes,
 * or transcodable image payloads.
 */
export function validateOfflineEnvironmentDecode(
  basis,
  bytes,
  label = "offline environment",
) {
  const file = new basis.KTX2File(new Uint8Array(bytes));
  try {
    if (!file.isValid() || !file.isUASTC() || file.isHDR()) {
      throw new Error(`${label}: shipped Basis decoder requires valid LDR UASTC`);
    }
    if (
      file.getWidth() !== 256 || file.getHeight() !== 256 ||
      file.getFaces() !== 6 || file.getLevels() !== 9 ||
      (file.getLayers() !== 0 && file.getLayers() !== 1)
    ) {
      throw new Error(
        `${label}: Basis decoded ${file.getWidth()}x${file.getHeight()} ` +
        `faces=${file.getFaces()} levels=${file.getLevels()} layers=${file.getLayers()}`,
      );
    }
    for (let face = 0; face < 6; face += 1) {
      for (let level = 0; level < 9; level += 1) {
        const info = file.getImageLevelInfo(level, 0, face);
        const expected = Math.max(1, 256 >> level);
        if (
          info.faceIndex !== face || info.levelIndex !== level ||
          info.origWidth !== expected || info.origHeight !== expected
        ) {
          throw new Error(
            `${label}: Basis face ${face} mip ${level} decoded as ` +
            `${info.origWidth}x${info.origHeight}; expected ${expected}x${expected}`,
          );
        }
      }
    }
    if (!file.startTranscoding()) {
      throw new Error(`${label}: Basis startTranscoding failed`);
    }
    // RGBA32 is the universal fallback selected by three.js when no compressed
    // GPU feature is present. Successfully exercising every face/mip proves the
    // payload is usable on both the compressed and fallback loader paths.
    const rgba32 = 13;
    let transcodedBytes = 0;
    for (let face = 0; face < 6; face += 1) {
      for (let level = 0; level < 9; level += 1) {
        const expected = Math.max(1, 256 >> level);
        const byteLength = file.getImageTranscodedSizeInBytes(level, 0, face, rgba32);
        if (byteLength !== expected * expected * 4) {
          throw new Error(
            `${label}: Basis face ${face} mip ${level} RGBA32 size ` +
            `${byteLength}; expected ${expected * expected * 4}`,
          );
        }
        const output = new Uint8Array(byteLength);
        if (!file.transcodeImage(output, level, 0, face, rgba32, 0, -1, -1)) {
          throw new Error(`${label}: Basis face ${face} mip ${level} transcode failed`);
        }
        transcodedBytes += byteLength;
      }
    }
    return Object.freeze({ faces: 6, levels: 9, transcodedBytes });
  } finally {
    file.close();
    file.delete();
  }
}
