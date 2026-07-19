import {
  FrameType,
  EntityKind,
  GameMode,
  GravityVariant,
  JoinKind,
  Ladder,
  MapPreference,
  type CmdFrame,
  PROTOCOL_VERSION,
  SNAPSHOT_SIZE_CEILING,
  packSnapshot,
  type EntityState,
} from "@gungame/protocol";

import { RoomManager, type PlayerPeer } from "../../server/src/rooms.js";
import { Buttons } from "@gungame/sim";

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
    kind: EntityKind.Player,
    health: 100,
    weaponTier: 1,
    ammo: 0,
    ownerId: 0,
    fireCmdSeq: 0,
    weaponId: 0,
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
const roomConfigs = [
  { mode: GameMode.GunGame, variant: GravityVariant.Standard, ladder: Ladder.Classic, mapPreference: MapPreference.AutoRotate },
  { mode: GameMode.GunGame, variant: GravityVariant.Scoutz, ladder: Ladder.Arsenal, mapPreference: MapPreference.Duna },
  { mode: GameMode.Scoutzknivez, variant: GravityVariant.Scoutz, ladder: Ladder.Classic, mapPreference: MapPreference.Spire },
  { mode: GameMode.GunGame, variant: GravityVariant.Standard, ladder: Ladder.Arsenal, mapPreference: MapPreference.Cascade },
] as const;
for (let roomIndex = 0; roomIndex < 4; roomIndex += 1) {
  const config = roomConfigs[roomIndex]!;
  const created = manager.join({
    type: FrameType.Hello,
    protocolVersion: PROTOCOL_VERSION,
    buildHash: "dev",
    joinKind: JoinKind.Create,
    mode: config.mode,
    variant: config.variant,
    ladder: config.ladder,
    mapPreference: config.mapPreference,
    name: `Room_${roomIndex}`,
    roomId: "",
    reconnectToken: new Uint8Array(),
  }, peer, 0);
  if ("refusal" in created) throw new Error(created.refusal);
  for (let player = 1; player < 12; player += 1) {
    const joined = created.room.add(peer, 0, `Bot_${roomIndex}_${player}`);
    if (joined === undefined) throw new Error("fixture room fill failed");
  }
  for (const slot of created.room.players.values()) {
    created.room.openBaseline(slot.id, 0);
    created.room.acknowledgeBaseline(slot.id, slot.epochs.epoch, 0);
  }
}
const tickTimes: number[] = [];
const roomTickTimes = new Map<string, number[]>();
for (let tick = 1; tick <= 512; tick += 1) {
  for (const room of manager.rooms.values()) {
    const slots = [...room.players.values()];
    for (const slot of slots) {
      const target = slots.find((candidate) => candidate.id !== slot.id && candidate.alive);
      const dx = (target?.state.player.position.x ?? 0) - slot.state.player.position.x;
      const dz = (target?.state.player.position.z ?? -1) - slot.state.player.position.z;
      const cmd: CmdFrame = {
        type: FrameType.Cmd,
        seq: tick,
        tick,
        buttons: Buttons.Fire | Buttons.Zoom | Buttons.Forward,
        viewYaw: Math.atan2(-dx, -dz) * 180 / Math.PI,
        viewPitch: 0,
        fireFraction: (tick * 37 + slot.id * 13) & 0xff,
        lastSnapshotTick: tick - 1,
        interpTargetTick: Math.max(0, tick - 5),
        interpTargetFraction: 0,
        baselineEpoch: slot.epochs.epoch,
      };
      room.acceptCmd(slot.id, cmd, tick * 1_000 / 64);
    }
  }
  const started = performance.now();
  for (const room of manager.rooms.values()) {
    const roomStarted = performance.now();
    room.tick(tick, tick * 1_000 / 64);
    const samples = roomTickTimes.get(room.id) ?? [];
    samples.push(performance.now() - roomStarted);
    roomTickTimes.set(room.id, samples);
  }
  tickTimes.push(performance.now() - started);
}
tickTimes.sort((a, b) => a - b);
const aggregateP95Ms = tickTimes[Math.ceil(tickTimes.length * 0.95) - 1] ?? 0;
const roomP95Ms = [...roomTickTimes.values()].map((samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.ceil(samples.length * 0.95) - 1] ?? 0;
});
const maxRoomP95Ms = Math.max(...roomP95Ms);
if (aggregateP95Ms >= 18) {
  throw new Error(`aggregate tick smoke exceeded 2x threshold: ${aggregateP95Ms.toFixed(3)}ms`);
}
console.log(JSON.stringify({
  snapshotMeanBytes: mean,
  snapshotMaxBytes: Math.max(...sizes),
  aggregateTickP95Ms: aggregateP95Ms,
  maxRoomTickP95Ms: maxRoomP95Ms,
  roomTickP95Ms: roomP95Ms,
  combatRooms: ["CLASSIC", "ARSENAL-scoutz", "Scoutzknivez", "ARSENAL-standard"],
  aggregateThresholdMs: 18,
}));
