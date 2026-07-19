import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Deploy builds ship prebaked outputs in git; regeneration needs local tools
// (magick/toktx/ffmpeg) that container builders lack (Prime deploy fix).
if (process.env.GG_PREBAKED_ASSETS === "1") {
  console.log(`[assets] GG_PREBAKED_ASSETS=1 — using committed outputs for ${import.meta.url.split("/").pop()}`);
  process.exit(0);
}

const root = resolve(import.meta.dirname, "../..");
const polyhaven = join(root, "assets/vendor/polyhaven");
const toolsRoot = join(
  root,
  "tools/vendor/ktx-expanded/KTX-Software-4.4.2-Darwin-arm64-tools.pkg/Payload/usr/local/bin",
);
const toktx = process.env.TOKTX ?? join(toolsRoot, "toktx");
const ktxMagic = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

if (!existsSync(toktx)) {
  throw new Error(`toktx unavailable: ${toktx}`);
}

const inputs = [];
for (const directory of readdirSync(polyhaven, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;
  const absolute = join(polyhaven, directory.name);
  for (const file of readdirSync(absolute)) {
    if (extname(file).toLowerCase() !== ".jpg") continue;
    inputs.push(join(absolute, file));
  }
}

for (const input of inputs) {
  const output = join(dirname(input), `${input.slice(0, -extname(input).length).split("/").at(-1)}.ktx2`);
  if (existsSync(output) && statSync(output).mtimeMs >= statSync(input).mtimeMs) continue;
  const srgb = input.endsWith("Diffuse.jpg");
  const result = spawnSync(toktx, [
    "--encode", "etc1s",
    "--clevel", "2",
    "--qlevel", srgb ? "180" : "150",
    "--threads", "1",
    "--genmipmap",
    "--filter", "kaiser",
    "--target_type", "RGB",
    "--assign_oetf", srgb ? "srgb" : "linear",
    output,
    input,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`toktx failed for ${input}: ${result.stderr || result.stdout}`);
  }
  const bytes = readFileSync(output);
  if (bytes.length < 128 || !bytes.subarray(0, ktxMagic.length).equals(ktxMagic)) {
    throw new Error(`invalid KTX2 output: ${output}`);
  }
}

console.log(JSON.stringify({
  textures: inputs.length,
  encoder: "toktx 4.4.2 ETC1S",
  mipped: true,
  maxSourceDimension: 1024,
}));
