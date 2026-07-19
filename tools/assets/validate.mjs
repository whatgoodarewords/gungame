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

if (glbs.length < 10) throw new Error(`expected at least 10 GLBs, got ${glbs.length}`);
if (archives.length !== 3) throw new Error(`expected 3 source archives, got ${archives.length}`);
if (normalizedAudio.length < 10) {
  throw new Error(`expected at least 10 normalized audio files, got ${normalizedAudio.length}`);
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
  if (bytes.length < 32_768 || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new Error(`invalid or implausibly small zip: ${path}`);
  }
}

for (const path of normalizedAudio) {
  const bytes = readFileSync(path);
  if (bytes.length < 1_024 || bytes.subarray(0, 4).toString("ascii") !== "OggS") {
    throw new Error(`invalid or implausibly small Ogg: ${path}`);
  }
}

const clientPayload = [...glbs, ...normalizedAudio];
const gzipBytes = clientPayload.reduce(
  (total, path) => total + gzipSync(readFileSync(path), { level: 9 }).byteLength,
  0,
);
const ceiling = 4 * 1024 * 1024;
if (gzipBytes > ceiling) {
  throw new Error(`client vendor gzip budget exceeded: ${gzipBytes} > ${ceiling}`);
}

console.log(JSON.stringify({
  glbs: glbs.length,
  archives: archives.length,
  normalizedAudio: normalizedAudio.length,
  vendorBytes: files.reduce((total, path) => total + statSync(path).size, 0),
  clientPayloadGzipBytes: gzipBytes,
  ceilingBytes: ceiling,
}));
