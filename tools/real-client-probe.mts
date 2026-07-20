// Decisive experiment for stuck-at-spawn: drive the REAL client network stack
// (NetworkSession + PredictionReconciler + the sim-bridge tick shape) against
// the local server. HeadlessBot probes bypass session.ts's gates — this does
// not. If this client moves, the bug is browser-environment-specific; if it
// sticks, the real client path is broken and we have a local repro.

// -- Browser-global shims (session.ts touches location/sessionStorage) --------
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get("ls:" + k) ?? null,
  setItem: (k: string, v: string) => void store.set("ls:" + k, v),
  removeItem: (k: string) => void store.delete("ls:" + k),
};
(globalThis as Record<string, unknown>).location = {
  hostname: "localhost",
  host: "localhost:5173",
  pathname: "/gg/",
  search: "",
  protocol: "http:",
  href: "http://localhost:5173/gg/",
};
// __BUILD_HASH__ is a vite define; the dev server expects "dev".
(globalThis as Record<string, unknown>).__BUILD_HASH__ = "dev";

// Origin gate: Node's WebSocket sends no Origin header, so ride the bot lane
// (ALLOW_HEADLESS_BOTS=1 on the local server) by injecting the subprotocol.
const RealWebSocket = globalThis.WebSocket;
class ProbeSocket extends RealWebSocket {
  constructor(url: string | URL) {
    super(url, "gungame-bot");
  }
}
(globalThis as Record<string, unknown>).WebSocket = ProbeSocket;

const { NetworkSession, PredictionReconciler } = await import(
  "/Volumes/SD/gungame/client/src/net/index.js"
);
const { createInitialState, CollisionWorld } = await import("@gungame/sim");
const { loadGameplayMap } = await import("@gungame/shared");
const { EntityKind } = await import("@gungame/protocol");

// Minimal map/world so prediction constraints behave (fetch the greybox blob
// straight from the repo's maps dir via the server's static route if present;
// otherwise run prediction without a world — movement math still runs).
let world: InstanceType<typeof CollisionWorld> | undefined;
try {
  const resp = await fetch("http://127.0.0.1:5173/gg/maps/greybox.blob");
  if (resp.ok) world = new CollisionWorld(loadGameplayMap(await resp.arrayBuffer()).collision);
} catch { /* prediction runs worldless */ }

let state = createInitialState();
const prediction = new PredictionReconciler(state, world);
let selfId = 0;
let welcomeAt = -1;
let firstSnapshotAt = -1;
let firstCmdSentAt = -1;
let snapshots = 0;
let lastProcessedCmdSeq = 0;
let serverSelfPos: { x: number; z: number } | undefined;
let firstServerSelfPos: { x: number; z: number } | undefined;
let closeInfo = "";
const t0 = Date.now();

const session = new NetworkSession({
  url: "ws://127.0.0.1:8787/gg/ws",
  onWelcome: () => { welcomeAt = Date.now() - t0; },
  onClose: (code: number, reason: string) => { closeInfo = `${code} ${reason}`; },
  onSnapshot: ({ frame, entities, resetPrediction }: {
    frame: { tick: number; lastProcessedCmdSeq: number };
    entities: ReadonlyArray<{ id: number; kind: number; position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number }; viewYaw: number; viewPitch: number; grounded: boolean; generation: number }>;
    resetPrediction: boolean;
  }) => {
    snapshots += 1;
    if (firstSnapshotAt < 0) firstSnapshotAt = Date.now() - t0;
    selfId = session.selfId;
    lastProcessedCmdSeq = Math.max(lastProcessedCmdSeq, frame.lastProcessedCmdSeq);
    const self = entities.find((e) => e.id === selfId && e.kind === EntityKind.Player);
    if (self !== undefined) {
      serverSelfPos = { x: self.position.x, z: self.position.z };
      firstServerSelfPos ??= serverSelfPos;
      const authoritative = {
        tick: frame.tick,
        player: {
          ...prediction.state.player,
          position: self.position,
          velocity: self.velocity,
          viewYaw: self.viewYaw,
          viewPitch: self.viewPitch,
          grounded: self.grounded,
        },
      };
      if (resetPrediction) prediction.resetForEpoch(authoritative);
      else prediction.reconcile(authoritative, frame.lastProcessedCmdSeq);
    }
  },
});

// The sim-bridge tick shape: 64 Hz, forward held, real sendCommand.
let nextSeq = 1;
const FORWARD = 1 << 0;
const tick = setInterval(() => {
  const cmd = {
    seq: nextSeq,
    tick: prediction.state.tick,
    buttons: FORWARD,
    viewYaw: 0,
    viewPitch: 0,
    fireFraction: 0,
    lastSnapshotTick: 0,
    interpTargetTick: 0,
    interpTargetFraction: 0,
  };
  nextSeq += 1;
  prediction.predict(cmd);
  const before = firstCmdSentAt;
  session.sendCommand(cmd, performance.now());
  // sendCommand returns void; detect "actually sent" via the epoch gate the
  // same way it decides: playerId!=0 && epoch!=0.
  if (before < 0 && session.selfId !== 0) firstCmdSentAt = Date.now() - t0;
}, 15.6);

setTimeout(() => {
  clearInterval(tick);
  const moved = firstServerSelfPos !== undefined && serverSelfPos !== undefined
    ? Math.hypot(serverSelfPos.x - firstServerSelfPos.x, serverSelfPos.z - firstServerSelfPos.z)
    : -1;
  console.log(JSON.stringify({
    welcomeAt,
    firstSnapshotAt,
    snapshots,
    selfId,
    cmdsBuilt: nextSeq - 1,
    lastProcessedCmdSeq,
    serverDisplacement: Number(moved.toFixed(3)),
    predictedDisplacement: Number(Math.hypot(
      prediction.state.player.position.x,
      prediction.state.player.position.z,
    ).toFixed(3)),
    closeInfo: closeInfo || "open",
  }, null, 1));
  session.close();
  process.exit(0);
}, 15_000);
