import {
  FrameType,
  GameMode,
  GravityVariant,
  JoinKind,
  PROTOCOL_VERSION,
  SNAPSHOT_SIZE_CEILING,
  packSnapshot,
  type EntityState,
} from "@gungame/protocol";

import { RoomManager, type PlayerPeer } from "../../server/src/rooms.js";

function players(tick: number): readonly EntityState[] {
  return Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    generation: 1,
    position: { x: index + tick * 0.01, y: 0, z: index * -2 },
    velocity: { x: 0.64, y: 0, z: 0 },
    viewYaw: index * 15,
    viewPitch: 0,
    grounded: true,
    alive: true,
  }));
}

let baseline = players(0);
const sizes: number[] = [];
for (let tick = 1; tick <= 128; tick += 1) {
  const current = players(tick);
  const bytes = packSnapshot({
    tick,
    lastProcessedCmdSeq: tick,
    cmdArrivalMargin: 2,
    baselineEpoch: 1,
    baselineTick: tick - 1,
    selfId: 1,
    entities: current,
    baselineEntities: baseline,
    events: [],
  }).bytes.length;
  if (bytes > SNAPSHOT_SIZE_CEILING) throw new Error(`snapshot ceiling breached: ${bytes}`);
  sizes.push(bytes);
  baseline = current;
}
const mean = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
if (mean > 400) throw new Error(`snapshot mean breached: ${mean}`);

const peer: PlayerPeer = {
  sendReliable: () => {},
  sendBaseline: () => {},
  sendSnapshot: () => {},
  disconnect: () => {},
};
const manager = new RoomManager(undefined, () => false);
for (let roomIndex = 0; roomIndex < 4; roomIndex += 1) {
  const created = manager.join({
    type: FrameType.Hello,
    protocolVersion: PROTOCOL_VERSION,
    buildHash: "dev",
    joinKind: JoinKind.Create,
    mode: GameMode.GunGame,
    variant: GravityVariant.Standard,
    roomId: "",
    reconnectToken: new Uint8Array(),
  }, peer, 0);
  if ("refusal" in created) throw new Error(created.refusal);
  for (let player = 1; player < 12; player += 1) {
    const joined = created.room.add(peer, 0);
    if (joined === undefined) throw new Error("fixture room fill failed");
  }
}
const tickTimes: number[] = [];
for (let tick = 1; tick <= 512; tick += 1) {
  const started = performance.now();
  manager.tick(tick, started);
  tickTimes.push(performance.now() - started);
}
tickTimes.sort((a, b) => a - b);
const aggregateP95Ms = tickTimes[Math.ceil(tickTimes.length * 0.95) - 1] ?? 0;
if (aggregateP95Ms >= 18) {
  throw new Error(`aggregate tick smoke exceeded 2x threshold: ${aggregateP95Ms.toFixed(3)}ms`);
}
console.log(JSON.stringify({
  snapshotMeanBytes: mean,
  snapshotMaxBytes: Math.max(...sizes),
  aggregateTickP95Ms: aggregateP95Ms,
  aggregateThresholdMs: 18,
}));
