import { readFileSync } from "node:fs";

import { loadGameplayMap } from "@gungame/shared";
import { CollisionWorld } from "@gungame/sim";

import { AuthoritativeLoop } from "./loop.js";
import { RoomManager } from "./rooms.js";
import { createTransport } from "./transport.js";

const DEFAULT_PORT = 8787;
const configuredPort = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);

if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new RangeError("PORT must be an integer between 1 and 65535");
}

const mapBytes = readFileSync(new URL("../../maps/greybox.blob", import.meta.url));
const map = loadGameplayMap(mapBytes);
const world = new CollisionWorld(map.collision, map.killVolumes);
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

app.listen(configuredPort, (listenSocket) => {
  if (listenSocket === false) {
    console.error(`failed to listen on port ${configuredPort}`);
    process.exit(1);
  }
  loop.start();
  console.log(`gungame server listening on http://localhost:${configuredPort}`);
});
