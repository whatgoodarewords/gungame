import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadGameplayMap } from "@gungame/shared";
import { CollisionWorld } from "@gungame/sim";

import { AuthoritativeLoop } from "./loop.js";
import { RoomManager } from "./rooms.js";
import { createTransport } from "./transport.js";

const DEFAULT_PORT = 8787;
const configuredPort = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
const staticRoot = resolve(fileURLToPath(new URL("../../client/dist", import.meta.url)));

if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new RangeError("PORT must be an integer between 1 and 65535");
}

interface StaticAsset {
  readonly body: Buffer;
  readonly contentType: string;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".blob": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function loadStaticAssets(root: string): ReadonlyMap<string, StaticAsset> {
  const assets = new Map<string, StaticAsset>();
  if (!existsSync(root)) return assets;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const key = relative(root, absolute).split(sep).join("/");
      assets.set(key, {
        body: readFileSync(absolute),
        contentType: CONTENT_TYPES[extname(entry.name).toLowerCase()] ?? "application/octet-stream",
      });
    }
  };
  visit(root);
  return assets;
}

const mapBytes = readFileSync(new URL("../../maps/greybox.blob", import.meta.url));
const map = loadGameplayMap(mapBytes);
const world = new CollisionWorld(map.collision, map.killVolumes);
const staticAssets = loadStaticAssets(staticRoot);
const spaIndex = staticAssets.get("index.html");
let loop: AuthoritativeLoop;
let sweepTimeouts = (_nowMs: number): void => {};
const rooms = new RoomManager(
  world,
  () => loop.refuseNewRooms,
  map.spawns.map((spawn) => spawn.position),
);
loop = new AuthoritativeLoop((tick) => {
  const nowMs = performance.now();
  rooms.tick(tick, nowMs);
  sweepTimeouts(nowMs);
});
const transport = createTransport(rooms);
const { app, connections } = transport;
sweepTimeouts = transport.sweepTimeouts;

app.get("/gg/healthz", (response) => {
  const metrics = loop.metrics;
  response
    .writeHeader("Content-Type", "application/json; charset=utf-8")
    .end(JSON.stringify({
      ok: true,
      tick: metrics.tick,
      tickP95Ms: metrics.aggregateP95Ms,
      rooms: rooms.rooms.size,
      connections: connections.size,
      overloaded: metrics.overloaded,
    }));
});

app.get("/gg", (response) => {
  response
    .writeStatus("301 Moved Permanently")
    .writeHeader("Location", "/gg/")
    .end();
});

app.get("/gg/*", (response, request) => {
  let key: string;
  try {
    key = decodeURIComponent(request.getUrl().slice("/gg/".length));
  } catch {
    response.writeStatus("400 Bad Request").end("invalid URL");
    return;
  }
  const asset = staticAssets.get(key === "" ? "index.html" : key) ?? spaIndex;
  if (asset === undefined) {
    response.writeStatus("503 Service Unavailable").end("client build unavailable");
    return;
  }
  response
    .writeHeader("Content-Type", asset.contentType)
    .writeHeader("X-Gungame-Build", __BUILD_HASH__)
    .writeHeader(
      "Cache-Control",
      key.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    )
    .end(asset.body);
});

app.listen("0.0.0.0", configuredPort, (listenSocket) => {
  if (listenSocket === false) {
    console.error(`failed to listen on port ${configuredPort}`);
    process.exit(1);
  }
  loop.start();
  console.log(`gungame server listening on http://0.0.0.0:${configuredPort}`);
});
