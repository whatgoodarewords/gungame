import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const toktx = join(
  root,
  "tools/vendor/ktx-expanded/KTX-Software-4.4.2-Darwin-arm64-tools.pkg",
  "Payload/usr/local/bin/toktx",
);
const hdri = [
  "polyhaven/empty_warehouse_01/empty_warehouse_01_1k.hdr",
  "polyhaven/industrial_sunset_02_puresky/industrial_sunset_02_puresky_1k.hdr",
  "polyhaven/rogland_sunset/rogland_sunset_1k.hdr",
  "polyhaven/overcast_industrial_courtyard/overcast_industrial_courtyard_1k.hdr",
];
const outputs = [];

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

for (const relative of hdri) {
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
  const magic = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb]);
  if (!bytes.subarray(0, 8).equals(magic) || bytes.length < 64 * 1024) {
    throw new Error(`invalid PMREM KTX2 output: ${output}`);
  }
  outputs.push({ file: output.slice(root.length + 1), bytes: bytes.length });
}

console.log(JSON.stringify({
  prefiltered: outputs.length,
  format: "KTX2 UASTC cubemap, 9-level offline roughness convolution",
  outputs,
}));
