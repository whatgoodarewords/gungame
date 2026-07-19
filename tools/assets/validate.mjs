import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "../..");
const vendor = join(root, "assets/vendor");
const files = [];

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.isFile()) files.push(path);
  }
}

visit(vendor);
const glbs = files.filter((path) => extname(path) === ".glb");
const archives = files.filter((path) => extname(path) === ".zip");
const normalizedAudio = files.filter((path) =>
  extname(path) === ".ogg" && !path.endsWith(".source.ogg"));
const ktx2 = files.filter((path) => extname(path) === ".ktx2");
const hdri = files.filter((path) => extname(path) === ".hdr");
const pmrem = ktx2.filter((path) => path.endsWith("_pmrem.ktx2"));

if (glbs.length < 12) throw new Error(`expected at least 12 GLBs, got ${glbs.length}`);
if (archives.length < 4) throw new Error(`expected at least 4 source archives, got ${archives.length}`);
if (normalizedAudio.length < 10) {
  throw new Error(`expected at least 10 normalized audio files, got ${normalizedAudio.length}`);
}
if (ktx2.length < 20 || pmrem.length !== 4 || hdri.length !== 4) {
  throw new Error(`texture acquisition incomplete: KTX2=${ktx2.length}, PMREM=${pmrem.length}, HDRI=${hdri.length}`);
}

for (const path of glbs) {
  const bytes = readFileSync(path);
  if (bytes.length < 4_096 || bytes.subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error(`invalid or implausibly small GLB: ${path}`);
  }
  if (bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error(`invalid GLB v2 header/length: ${path}`);
  }
}

for (const path of archives) {
  const bytes = readFileSync(path);
  const centralDirectory = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (
    bytes.length < 32_768 ||
    !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    centralDirectory < 0
  ) {
    throw new Error(`invalid archive or HTML masquerading as zip: ${path}`);
  }
}

for (const path of normalizedAudio) {
  const bytes = readFileSync(path);
  if (bytes.length < 1_024 || bytes.subarray(0, 4).toString("ascii") !== "OggS") {
    throw new Error(`invalid or implausibly small Ogg: ${path}`);
  }
}

const ktxMagic = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb]);
let runtimeTextureGpuBytes = 0;
for (const path of ktx2) {
  const bytes = readFileSync(path);
  if (bytes.length < 1_024 || !bytes.subarray(0, 8).equals(ktxMagic)) {
    throw new Error(`invalid KTX2: ${path}`);
  }
  const width = bytes.readUInt32LE(20);
  const height = Math.max(1, bytes.readUInt32LE(24));
  const faces = Math.max(1, bytes.readUInt32LE(36));
  const levels = bytes.readUInt32LE(40);
  if (width > 1_024 || height > 1_024 || levels < 2) {
    throw new Error(`KTX2 violates 1K+mip policy: ${path} ${width}x${height} levels=${levels}`);
  }
  // Browser targets transcode Basis/UASTC to a 4x4 block GPU format. One byte
  // per texel plus the complete mip chain is a conservative ASTC/BC7 estimate.
  runtimeTextureGpuBytes += Math.ceil(width * height * faces * 4 / 3);
}
const gpuCeiling = 64 * 1024 * 1024;
if (runtimeTextureGpuBytes > gpuCeiling) {
  throw new Error(`GPU texture budget exceeded: ${runtimeTextureGpuBytes} > ${gpuCeiling}`);
}

for (const path of hdri) {
  const bytes = readFileSync(path);
  const header = bytes.subarray(0, 1_024).toString("ascii");
  if (!header.includes("#?RADIANCE") || !/-Y\s+512\s+\+X\s+1024/.test(header)) {
    throw new Error(`invalid or non-1K Radiance HDRI: ${path}`);
  }
}

const licenseText = readFileSync(join(vendor, "LICENSES.md"), "utf8");
for (const required of ["wrad-arms", "Quaternius", "Kenney", "Poly Haven", "CreativeTrio"]) {
  if (!licenseText.includes(required)) throw new Error(`LICENSES.md missing ${required}`);
}

const clientPayload = [
  ...glbs,
  ...normalizedAudio,
  ...ktx2.filter((path) => !path.endsWith("nor_gl.ktx2")),
];
const gzipBytes = clientPayload.reduce(
  (total, path) => total + gzipSync(readFileSync(path), { level: 9 }).byteLength,
  0,
);
const ceiling = 8 * 1024 * 1024;
if (gzipBytes > ceiling) {
  throw new Error(`client vendor gzip budget exceeded: ${gzipBytes} > ${ceiling}`);
}

console.log(JSON.stringify({
  glbs: glbs.length,
  archives: archives.length,
  normalizedAudio: normalizedAudio.length,
  ktx2: ktx2.length,
  offlinePmrem: pmrem.length,
  hdri: hdri.length,
  gpuTextureBytes: runtimeTextureGpuBytes,
  gpuTextureCeilingBytes: gpuCeiling,
  vendorBytes: files.reduce((total, path) => total + statSync(path).size, 0),
  clientPayloadGzipBytes: gzipBytes,
  ceilingBytes: ceiling,
}));
