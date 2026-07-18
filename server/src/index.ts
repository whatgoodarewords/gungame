import uWS from "uWebSockets.js";

const DEFAULT_PORT = 8787;
const configuredPort = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);

if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new RangeError("PORT must be an integer between 1 and 65535");
}

const app = uWS.App();

app.get("/gg/healthz", (response) => {
  response
    .writeHeader("Content-Type", "application/json; charset=utf-8")
    .end(JSON.stringify({ ok: true, tick: 0 }));
});

app.listen(configuredPort, (listenSocket) => {
  if (listenSocket === false) {
    console.error(`failed to listen on port ${configuredPort}`);
    process.exit(1);
  }

  console.log(`gungame server listening on http://localhost:${configuredPort}`);
});
