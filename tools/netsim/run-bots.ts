import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadGameplayMap } from "@gungame/shared";
import { CollisionWorld } from "@gungame/sim";
import { GameMode, GravityVariant, Ladder } from "@gungame/protocol";

import { HeadlessBot } from "./bot.js";

interface Arguments {
  readonly bots: number;
  readonly durationSeconds: number;
  readonly output: string;
  readonly url: string;
  readonly seed: number;
  readonly profile: string;
  readonly mode: typeof GameMode[keyof typeof GameMode];
  readonly variant: typeof GravityVariant[keyof typeof GravityVariant];
  readonly ladder: typeof Ladder[keyof typeof Ladder];
}

function parse(): Arguments {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (key !== undefined && value !== undefined) values.set(key, value);
  }
  const mode = values.get("--mode") === "scoutz" ? GameMode.Scoutzknivez : GameMode.GunGame;
  const ladder = values.get("--ladder") === "arsenal" ? Ladder.Arsenal : Ladder.Classic;
  const variant = values.get("--gravity") === "scoutz" ? GravityVariant.Scoutz : GravityVariant.Standard;
  return {
    bots: Number.parseInt(values.get("--bots") ?? "2", 10),
    durationSeconds: Number.parseFloat(values.get("--duration") ?? "30"),
    output: values.get("--output") ?? "tools/netsim/reports/latest.json",
    url: values.get("--url") ?? "ws://127.0.0.1:8787/gg/ws",
    seed: Number.parseInt(values.get("--seed") ?? "424242", 10),
    profile: values.get("--profile") ?? "local",
    mode,
    ladder,
    variant,
  };
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

const args = parse();
if (
  !Number.isInteger(args.bots) ||
  args.bots < 1 ||
  args.bots > 12 ||
  !Number.isFinite(args.durationSeconds) ||
  args.durationSeconds <= 0
) {
  throw new RangeError("bots must be 1..12 and duration must be positive");
}

const map = loadGameplayMap(
  readFileSync(new URL("../../maps/greybox.blob", import.meta.url)),
);
const world = new CollisionWorld(map.collision, map.killVolumes);
const first = new HeadlessBot({
  id: 1,
  url: args.url,
  world,
  seed: args.seed,
  mode: args.mode,
  variant: args.variant,
  ladder: args.ladder,
  create: true,
});
first.start();
await Promise.race([
  first.ready,
  delay(10_000).then(() => {
    throw new Error("first bot did not install a baseline within 10 seconds");
  }),
]);
const bots = [first, ...Array.from({ length: args.bots - 1 }, (_, index) => new HeadlessBot({
  id: index + 2,
  url: args.url,
  world,
  seed: args.seed + (index + 1) * 1_013,
  mode: args.mode,
  variant: args.variant,
  ladder: args.ladder,
  roomId: first.joinedRoomId,
}))];
for (const bot of bots.slice(1)) bot.start();
await Promise.race([
  Promise.all(bots.slice(1).map((bot) => bot.ready)),
  delay(10_000).then(() => {
    throw new Error("bots did not install baselines within 10 seconds");
  }),
]);
await delay(args.durationSeconds * 1_000);
for (const bot of bots) bot.stop();
await delay(100);

const metrics = bots.map((bot) => bot.metrics());
const corrections = metrics.flatMap((metric) => metric.corrections);
const stalls = metrics.flatMap((metric) => metric.remoteStallsMs);
const snapshotBytes = metrics.flatMap((metric) => metric.snapshotBytes);
const protocolErrors = metrics.reduce((sum, metric) => sum + metric.protocolErrors, 0);
const report = {
  schemaVersion: 2,
  transport: "ws",
  byteBoundary: "WebSocket binary payload (TCP payload before framing/TLS overhead)",
  profile: args.profile,
  seed: args.seed,
  bots: args.bots,
  durationSeconds: args.durationSeconds,
  mode: args.mode === GameMode.Scoutzknivez ? "scoutzknivez" : "gun-game",
  ladder: args.ladder === Ladder.Arsenal ? "ARSENAL" : "CLASSIC",
  gravity: args.variant === GravityVariant.Scoutz ? "scoutz" : "standard",
  predictionCorrectionP95M: percentile(corrections, 0.95),
  remoteEntityStallP95Ms: percentile(stalls, 0.95),
  reconnectCount: metrics.reduce((sum, metric) => sum + metric.reconnectCount, 0),
  protocolErrors,
  meanSnapshotBytes: snapshotBytes.length === 0
    ? 0
    : snapshotBytes.reduce((sum, value) => sum + value, 0) / snapshotBytes.length,
  maxSnapshotBytes: snapshotBytes.reduce((maximum, value) => Math.max(maximum, value), 0),
  snapshots: snapshotBytes.length,
  movementMirrored: args.bots === 1 || metrics.every((metric) => metric.sawRemoteMovement),
  projectileCombatObserved: args.ladder !== Ladder.Arsenal || metrics.some((metric) => metric.sawProjectile),
  winnerObserved: metrics.some((metric) => metric.sawWinner),
  restartObserved: metrics.some((metric) => metric.sawRestartAfterWinner),
};
mkdirSync(dirname(args.output), { recursive: true });
writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (
  report.protocolErrors !== 0 ||
  !report.movementMirrored ||
  report.meanSnapshotBytes > 400 ||
  !report.projectileCombatObserved
) process.exitCode = 1;
