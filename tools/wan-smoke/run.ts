import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { FrameType, decodeFrame, encodeFrame } from "@gungame/protocol";
import { loadGameplayMap } from "@gungame/shared";
import { CollisionWorld } from "@gungame/sim";

import { HeadlessBot } from "../netsim/bot.js";

interface Arguments {
  readonly bots: number;
  readonly durationSeconds: number;
  readonly output: string | undefined;
  readonly seed: number;
  readonly url: string;
  readonly baseUrl: string;
}

function usage(): string {
  return [
    "Usage: pnpm wan-smoke -- [options]",
    "",
    "  --url <ws-url>       WebSocket endpoint (default: wss://dev.sml.world/gg/ws)",
    "  --base-url <url>     HTTPS app base (default: derived from --url)",
    "  --bots <1..12>       Headless bot count (default: 12)",
    "  --duration <seconds> Movement duration (default: 60)",
    "  --seed <integer>     Deterministic workload seed (default: 424242)",
    "  --output <path>      Also write the metrics JSON to this path",
    "  --help               Show this help",
  ].join("\n");
}

function derivedBaseUrl(wsUrl: string): string {
  const parsed = new URL(wsUrl);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  parsed.pathname = "/gg/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function parse(): Arguments {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (key === "--") continue;
    if (key === "--help") {
      console.log(usage());
      process.exit(0);
    }
    const value = process.argv[index + 1];
    if (key === undefined || !key.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument near '${key ?? ""}'\n${usage()}`);
    }
    values.set(key, value);
    index += 1;
  }
  const url = values.get("--url") ?? "wss://dev.sml.world/gg/ws";
  return {
    bots: Number.parseInt(values.get("--bots") ?? "12", 10),
    durationSeconds: Number.parseFloat(values.get("--duration") ?? "60"),
    output: values.get("--output"),
    seed: Number.parseInt(values.get("--seed") ?? "424242", 10),
    url,
    baseUrl: values.get("--base-url") ?? derivedBaseUrl(url),
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

async function checkEndpoint(url: URL, expectedContentType: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { "User-Agent": "gungame-wan-smoke/1" },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes(expectedContentType)) {
    throw new Error(`${url} returned unexpected Content-Type '${contentType}'`);
  }
  if (expectedContentType === "application/json") {
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("ok" in body) ||
      body.ok !== true
    ) {
      throw new Error(`${url} did not return an ok health payload`);
    }
  } else {
    await response.arrayBuffer();
  }
  console.error(`HTTPS PASS ${url} (${contentType})`);
  return response;
}

function installBuildHashWebSocket(buildHash: string): void {
  const NativeWebSocket = WebSocket;
  globalThis.WebSocket = class extends NativeWebSocket {
    override send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (ArrayBuffer.isView(data)) {
        try {
          const frame = decodeFrame(
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
          );
          if (frame.type === FrameType.Hello) {
            super.send(encodeFrame({ ...frame, buildHash }));
            return;
          }
        } catch {
          // Non-protocol data follows the native WebSocket path unchanged.
        }
      }
      super.send(data);
    }
  };
}

const args = parse();
if (
  !Number.isInteger(args.bots) ||
  args.bots < 1 ||
  args.bots > 12 ||
  !Number.isFinite(args.durationSeconds) ||
  args.durationSeconds <= 0 ||
  !Number.isInteger(args.seed)
) {
  throw new RangeError("bots must be 1..12; duration must be positive; seed must be an integer");
}
const wsUrl = new URL(args.url);
if (wsUrl.protocol !== "ws:" && wsUrl.protocol !== "wss:") {
  throw new Error("--url must use ws:// or wss://");
}
const appUrl = new URL(args.baseUrl);
appUrl.pathname = "/gg/";
appUrl.search = "";
appUrl.hash = "";
const healthUrl = new URL("/gg/healthz", appUrl);

const appResponse = await checkEndpoint(appUrl, "text/html");
await checkEndpoint(healthUrl, "application/json");
const buildHash = appResponse.headers.get("x-gungame-build");
if (buildHash === null || buildHash === "") {
  throw new Error(`${appUrl} did not expose X-Gungame-Build`);
}
installBuildHashWebSocket(buildHash);
console.error(`WS build handshake: ${buildHash}`);

const map = loadGameplayMap(
  readFileSync(new URL("../../maps/greybox.blob", import.meta.url)),
);
const world = new CollisionWorld(map.collision, map.killVolumes);
const bots = Array.from({ length: args.bots }, (_, index) => new HeadlessBot({
  id: index + 1,
  url: wsUrl.toString(),
  world,
  seed: args.seed + index * 1_013,
}));

try {
  for (const bot of bots) bot.start();
  await Promise.race([
    Promise.all(bots.map((bot) => bot.ready)),
    delay(15_000).then(() => {
      throw new Error("bots did not install baselines within 15 seconds");
    }),
  ]);
  await delay(args.durationSeconds * 1_000);
} finally {
  for (const bot of bots) bot.stop();
  await delay(100);
}

const metrics = bots.map((bot) => bot.metrics());
const corrections = metrics.flatMap((metric) => metric.corrections);
const stalls = metrics.flatMap((metric) => metric.remoteStallsMs);
const snapshotBytes = metrics.flatMap((metric) => metric.snapshotBytes);
const report = {
  schemaVersion: 1,
  transport: "ws",
  environment: "wan",
  byteBoundary: "WebSocket binary payload (TCP payload before framing/TLS overhead)",
  profile: "wan",
  seed: args.seed,
  bots: args.bots,
  durationSeconds: args.durationSeconds,
  predictionCorrectionP95M: percentile(corrections, 0.95),
  remoteEntityStallP95Ms: percentile(stalls, 0.95),
  reconnectCount: metrics.reduce((sum, metric) => sum + metric.reconnectCount, 0),
  protocolErrors: metrics.reduce((sum, metric) => sum + metric.protocolErrors, 0),
  meanSnapshotBytes: snapshotBytes.length === 0
    ? 0
    : snapshotBytes.reduce((sum, value) => sum + value, 0) / snapshotBytes.length,
  maxSnapshotBytes: snapshotBytes.reduce((maximum, value) => Math.max(maximum, value), 0),
  snapshots: snapshotBytes.length,
  movementMirrored: args.bots === 1 || metrics.every((metric) => metric.sawRemoteMovement),
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (args.output !== undefined) {
  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, json);
}
process.stdout.write(json);
if (report.protocolErrors !== 0 || !report.movementMirrored) process.exitCode = 1;
