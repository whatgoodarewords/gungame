import { copyFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const selectedDirectories = [
  "assets/vendor/kenney-impact/selected",
  "assets/vendor/kenney-sci-fi/selected",
  "assets/vendor/kenney-interface/selected",
].map((path) => join(root, path));

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
// A 0.1 dB guard keeps decoded Opus peaks at or below the -6 dBFS ceiling.
const TARGET_PEAK_DB = -6.1;

function measuredPeak(path) {
  const probe = spawnSync("ffmpeg", [
    "-hide_banner", "-nostats", "-i", path,
    "-af", "volumedetect", "-f", "null", "-",
  ], { encoding: "utf8" });
  const match = `${probe.stdout}${probe.stderr}`.match(/max_volume:\s*(-?[\d.]+) dB/);
  if (match === null) throw new Error(`could not measure audio peak: ${path}`);
  return Number(match[1]);
}

for (const directory of selectedDirectories) {
  for (const name of readdirSync(directory).filter((value) => value.endsWith(".source.ogg"))) {
    const source = join(directory, name);
    const output = join(dirname(source), basename(source, ".source.ogg") + ".ogg");
    if (!hasFfmpeg) {
      if (!existsSync(output)) throw new Error(`ffmpeg unavailable and normalized asset missing: ${output}`);
      continue;
    }
    let gain = TARGET_PEAK_DB - measuredPeak(source);
    let bestError = Number.POSITIVE_INFINITY;
    const temporary = `${output}.tmp.ogg`;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const normalized = spawnSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y", "-i", source,
        "-af", `volume=${gain.toFixed(2)}dB`,
        "-c:a", "libopus", "-b:a", "96k", temporary,
      ], { stdio: "inherit" });
      if (normalized.status !== 0) throw new Error(`audio normalization failed: ${source}`);
      const error = TARGET_PEAK_DB - measuredPeak(temporary);
      if (Math.abs(error) < bestError) {
        bestError = Math.abs(error);
        copyFileSync(temporary, output);
      }
      if (Math.abs(error) <= 0.05) break;
      gain += error;
    }
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

console.log("audio assets normalized to -6 dB peak");
