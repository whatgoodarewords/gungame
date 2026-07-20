import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  ENVIRONMENT_FORMAT,
  ENVIRONMENT_HDRI,
  loadShippedBasisTranscoder,
  validateOfflineEnvironmentDecode,
  validateOfflineEnvironmentKtx2,
} from "./environment-contract.mjs";

// Deploy builds ship prebaked outputs in git; regeneration needs local tools
// (magick/toktx/ffmpeg) that container builders lack (Prime deploy fix).
if (process.env.GG_PREBAKED_ASSETS === "1") {
  console.log(`[assets] GG_PREBAKED_ASSETS=1 — using committed outputs for ${import.meta.url.split("/").pop()}`);
  process.exit(0);
}

const root = resolve(import.meta.dirname, "../..");
const toktx = join(
  root,
  "tools/vendor/ktx-expanded/KTX-Software-4.4.2-Darwin-arm64-tools.pkg",
  "Payload/usr/local/bin/toktx",
);
const outputs = [];
const basis = await loadShippedBasisTranscoder(root);

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

for (const relative of ENVIRONMENT_HDRI) {
  const source = join(root, "assets/vendor", relative);
  const output = join(dirname(source), `${basename(source, ".hdr")}_pmrem.ktx2`);
  const scratch = mkdtempSync(join(tmpdir(), "gungame-pmrem-"));
  const equirect = join(scratch, "equirect.png");
  const strip = join(scratch, "cube.png");

  // Convert Radiance data once, then project the lat-long image to six
  // left-handed cube faces. The explicit mip chain below is deliberately
  // roughness-prefiltered offline: increasingly wide spherical source
  // footprints become increasingly diffuse environment samples.
  run("magick", [source, "-define", "png:bit-depth=16", equirect]);
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", equirect,
    "-vf", "v360=input=equirect:output=c6x1:w=1536:h=256",
    "-frames:v", "1", strip,
  ]);
  run("magick", [strip, "-crop", "256x256", "+repage", join(scratch, "face-%d.png")]);

  const inputs = [];
  for (let face = 0; face < 6; face += 1) {
    const faceSource = join(scratch, `face-${face}.png`);
    for (let level = 0; level < 9; level += 1) {
      const size = 256 >> level;
      const roughness = level / 8;
      const levelPath = join(scratch, `face-${face}-level-${level}.png`);
      const blur = Math.max(0.01, roughness * roughness * 20);
      run("magick", [
        faceSource,
        "-filter", "Lanczos",
        "-blur", `0x${blur}`,
        "-resize", `${size}x${size}!`,
        "-define", "png:bit-depth=16",
        levelPath,
      ]);
      inputs.push(levelPath);
    }
  }

  run(toktx, [
    "--t2", "--cubemap", "--mipmap", "--levels", "9",
    "--assign_oetf", "linear", "--uastc", "2",
    output, ...inputs,
  ]);
  const bytes = readFileSync(output);
  validateOfflineEnvironmentKtx2(bytes, output);
  validateOfflineEnvironmentDecode(basis, bytes, output);
  outputs.push({ file: output.slice(root.length + 1), bytes: bytes.length });
}

console.log(JSON.stringify({
  prefiltered: outputs.length,
  format: ENVIRONMENT_FORMAT,
  outputs,
}));
