import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ENVIRONMENT_FORMAT,
  ENVIRONMENT_HDRI,
  environmentOutputPath,
  loadShippedBasisTranscoder,
  validateOfflineEnvironmentDecode,
  validateOfflineEnvironmentKtx2,
} from "./environment-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const basis = await loadShippedBasisTranscoder(root);
const validated = ENVIRONMENT_HDRI.map((relativeHdri) => {
  const path = environmentOutputPath(root, relativeHdri);
  const bytes = readFileSync(path);
  const result = validateOfflineEnvironmentKtx2(bytes, path);
  const decoded = validateOfflineEnvironmentDecode(basis, bytes, path);
  return {
    file: path.slice(root.length + 1),
    bytes: bytes.byteLength,
    faces: result.faces,
    levels: result.levels.length,
    transcodedBytes: decoded.transcodedBytes,
  };
});

console.log(JSON.stringify({
  validator: "offline-environment-contract",
  format: ENVIRONMENT_FORMAT,
  validated,
}));
