import {
  EntityFlags,
  EntityKind,
  EventKind,
  FrameType,
  MAX_BUILD_HASH_BYTES,
  MAX_ENTITY_DELTAS,
  MAX_EVENTS,
  MAX_FRAME_BYTES,
  MAX_HELLO_BYTES,
  MAX_PLAYER_NAME_BYTES,
  MAX_RECONNECT_TOKEN_BYTES,
  MAX_ROOM_ID_BYTES,
  SnapshotFlags,
} from "./constants.js";
import { ProtocolError, Reader, Writer, assertFinite, assertUint } from "./binary.js";
import type {
  BaselineAckFrame,
  CmdFrame,
  EntityDelta,
  HelloFrame,
  PingFrame,
  PongFrame,
  ProtocolFrame,
  RefusalFrame,
  SnapshotFrame,
  WelcomeFrame,
} from "./types.js";

const CMD_BYTES = 27;

function normalizeYaw(value: number): number {
  assertFinite(value, "viewYaw");
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function quantizeYaw(value: number): number {
  return Math.round((normalizeYaw(value) / 180) * 32_767);
}

export function dequantizeYaw(value: number): number {
  return (value / 32_767) * 180;
}

export function clampPitch(value: number): number {
  assertFinite(value, "viewPitch");
  return Math.max(-89, Math.min(89, value));
}

export function quantizePitch(value: number): number {
  return Math.round((clampPitch(value) / 89) * 32_767);
}

export function dequantizePitch(value: number): number {
  return (value / 32_767) * 89;
}

function writeToken(writer: Writer, token: Uint8Array): void {
  if (token.length !== 0 && token.length !== MAX_RECONNECT_TOKEN_BYTES) {
    throw new ProtocolError("reconnectToken must be empty or 16 bytes");
  }
  writer.u8(token.length, "reconnectToken.length");
  writer.raw(token);
}

function readToken(reader: Reader): Uint8Array {
  const count = reader.u8();
  if (count !== 0 && count !== MAX_RECONNECT_TOKEN_BYTES) {
    throw new ProtocolError("reconnectToken must be empty or 16 bytes");
  }
  return reader.raw(count);
}

function encodeHello(frame: HelloFrame): Uint8Array {
  const writer = new Writer();
  writer.u8(FrameType.Hello);
  writer.u16(frame.protocolVersion, "protocolVersion");
  writer.ascii(frame.buildHash, MAX_BUILD_HASH_BYTES, "buildHash");
  writer.u8(frame.joinKind, "joinKind");
  writer.u8(frame.mode, "mode");
  writer.u8(frame.variant, "variant");
  writer.u8(frame.ladder, "ladder");
  writer.u8(frame.mapPreference, "mapPreference");
  writer.ascii(frame.name, MAX_PLAYER_NAME_BYTES, "name");
  writer.ascii(frame.roomId, MAX_ROOM_ID_BYTES, "roomId");
  writeToken(writer, frame.reconnectToken);
  const bytes = writer.finish();
  if (bytes.length > MAX_HELLO_BYTES) throw new ProtocolError("hello exceeds hard limit");
  return bytes;
}

function encodeCmd(frame: CmdFrame): Uint8Array {
  const writer = new Writer();
  writer.u8(FrameType.Cmd);
  writer.u32(frame.seq, "seq");
  writer.u32(frame.tick, "tick");
  writer.u16(frame.buttons, "buttons");
  writer.i16(quantizeYaw(frame.viewYaw), "viewYaw");
  writer.i16(quantizePitch(frame.viewPitch), "viewPitch");
  writer.u8(frame.fireFraction, "fireFraction");
  writer.u32(frame.lastSnapshotTick, "lastSnapshotTick");
  writer.u32(frame.interpTargetTick, "interpTargetTick");
  writer.u8(frame.interpTargetFraction, "interpTargetFraction");
  writer.u16(frame.baselineEpoch, "baselineEpoch");
  return writer.finish();
}

function entityFlags(entity: EntityDelta): number {
  let flags = 0;
  if (entity.create === true) flags |= EntityFlags.Create;
  if (entity.delete === true) flags |= EntityFlags.Delete;
  if (entity.position !== undefined) flags |= EntityFlags.Position;
  if (entity.velocity !== undefined) flags |= EntityFlags.Velocity;
  if (entity.viewYaw !== undefined || entity.viewPitch !== undefined) flags |= EntityFlags.Angles;
  if (
    entity.grounded !== undefined ||
    entity.alive !== undefined ||
    entity.ducked !== undefined
  ) flags |= EntityFlags.Status;
  if (
    entity.kind !== undefined || entity.health !== undefined || entity.weaponTier !== undefined ||
    entity.ammo !== undefined || entity.ownerId !== undefined || entity.fireCmdSeq !== undefined ||
    entity.weaponId !== undefined
  ) flags |= EntityFlags.Combat;
  if (entity.self === true) flags |= EntityFlags.Self;
  if ((flags & EntityFlags.Create) !== 0) {
    flags |= EntityFlags.Position | EntityFlags.Velocity | EntityFlags.Combat;
    if ((entity.kind ?? EntityKind.Player) === EntityKind.Player) {
      flags |= EntityFlags.Angles | EntityFlags.Status;
    }
  }
  if ((flags & EntityFlags.Delete) !== 0 && (flags & ~(EntityFlags.Delete | EntityFlags.Self)) !== 0) {
    throw new ProtocolError("delete delta cannot carry entity state");
  }
  return flags;
}

function writeEntity(writer: Writer, entity: EntityDelta): void {
  assertUint(entity.id, 16, "entity.id");
  assertUint(entity.generation, 16, "entity.generation");
  const flags = entityFlags(entity);
  writer.u16(entity.id);
  writer.u16(entity.generation);
  writer.u8(flags);
  if ((flags & EntityFlags.Delete) !== 0) return;
  if ((flags & EntityFlags.Position) !== 0) {
    if (entity.position === undefined) throw new ProtocolError("entity position missing");
    writer.f32(entity.position.x, "position.x");
    writer.f32(entity.position.y, "position.y");
    writer.f32(entity.position.z, "position.z");
  }
  if ((flags & EntityFlags.Velocity) !== 0) {
    if (entity.velocity === undefined) throw new ProtocolError("entity velocity missing");
    writer.f32(entity.velocity.x, "velocity.x");
    writer.f32(entity.velocity.y, "velocity.y");
    writer.f32(entity.velocity.z, "velocity.z");
  }
  if ((flags & EntityFlags.Angles) !== 0) {
    if (entity.viewYaw === undefined || entity.viewPitch === undefined) {
      throw new ProtocolError("entity angles missing");
    }
    writer.i16(quantizeYaw(entity.viewYaw));
    writer.i16(quantizePitch(entity.viewPitch));
  }
  if ((flags & EntityFlags.Status) !== 0) {
    if (
      entity.grounded === undefined ||
      entity.alive === undefined ||
      entity.ducked === undefined
    ) {
      throw new ProtocolError("entity status missing");
    }
    writer.u8(
      (entity.grounded ? 1 : 0) |
      (entity.alive ? 2 : 0) |
      (entity.ducked ? 4 : 0),
    );
  }
  if ((flags & EntityFlags.Combat) !== 0) {
    if (entity.kind === undefined) throw new ProtocolError("entity kind missing");
    writer.u8(entity.kind, "entity.kind");
    if (entity.kind === EntityKind.Player) {
      if (entity.health === undefined || entity.weaponTier === undefined || entity.ammo === undefined) {
        throw new ProtocolError("player combat state missing");
      }
      writer.u8(entity.health, "entity.health");
      writer.u8(entity.weaponTier, "entity.weaponTier");
      writer.u8(entity.ammo, "entity.ammo");
    } else if (entity.kind === EntityKind.Projectile) {
      if (entity.ownerId === undefined || entity.fireCmdSeq === undefined || entity.weaponId === undefined) {
        throw new ProtocolError("projectile ownership missing");
      }
      writer.u16(entity.ownerId, "entity.ownerId");
      writer.u32(entity.fireCmdSeq, "entity.fireCmdSeq");
      writer.u8(entity.weaponId, "entity.weaponId");
    } else {
      throw new ProtocolError("unknown entity kind");
    }
  }
}

function encodeSnapshot(frame: SnapshotFrame): Uint8Array {
  if (frame.entities.length > MAX_ENTITY_DELTAS) throw new ProtocolError("too many entity deltas");
  if (frame.events.length > MAX_EVENTS) throw new ProtocolError("too many events");
  const writer = new Writer();
  writer.u8(FrameType.Snapshot);
  writer.u8((frame.full ? SnapshotFlags.Full : 0) |
    (frame.modeState === undefined ? 0 : SnapshotFlags.ModeState));
  writer.u32(frame.tick, "tick");
  writer.u32(frame.lastProcessedCmdSeq, "lastProcessedCmdSeq");
  writer.i8(frame.cmdArrivalMargin, "cmdArrivalMargin");
  writer.u16(frame.baselineEpoch, "baselineEpoch");
  writer.u32(frame.baselineTick, "baselineTick");
  writer.u8(frame.entities.length, "entityCount");
  writer.u8(frame.events.length, "eventCount");
  if (frame.modeState !== undefined) {
    const mode = frame.modeState;
    if (mode.scoreboard.length > 12) throw new ProtocolError("too many scoreboard entries");
    writer.u8(mode.mode, "modeState.mode");
    writer.u8(mode.ladder, "modeState.ladder");
    writer.u8(mode.mapId, "modeState.mapId");
    writer.u8(mode.roundState, "modeState.roundState");
    writer.u16(mode.winnerId, "modeState.winnerId");
    writer.u16(mode.restartTicksRemaining, "modeState.restartTicksRemaining");
    writer.u8(mode.teamScores[0], "modeState.teamScore0");
    writer.u8(mode.teamScores[1], "modeState.teamScore1");
    writer.u8(mode.scoreboard.length, "modeState.scoreboardCount");
    for (const entry of mode.scoreboard) {
      writer.u16(entry.playerId, "scoreboard.playerId");
      writer.ascii(entry.name ?? `P${entry.playerId}`, MAX_PLAYER_NAME_BYTES, "scoreboard.name");
      writer.u16(entry.kills, "scoreboard.kills");
      writer.u16(entry.deaths, "scoreboard.deaths");
      writer.u8(entry.team, "scoreboard.team");
      writer.u8(entry.tier, "scoreboard.tier");
      writer.u8(entry.bot === true ? 1 : 0, "scoreboard.bot");
    }
  }
  for (const entity of frame.entities) writeEntity(writer, entity);
  for (const event of frame.events) {
    writer.u32(event.id, "event.id");
    writer.u32(event.tick, "event.tick");
    writer.u8(event.kind, "event.kind");
    writer.u16(event.actorId, "event.actorId");
    writer.u16(event.targetId, "event.targetId");
    writer.u16(event.amount, "event.amount");
    writer.u8(event.weaponId, "event.weaponId");
    writer.u8(event.flags, "event.flags");
    if (event.kind === EventKind.ModeEnd) {
      if (event.stats === undefined) throw new ProtocolError("mode-end event missing stats");
      writer.u16(event.stats.airshots, "event.stats.airshots");
      writer.u16(event.stats.topSpeedDeci, "event.stats.topSpeedDeci");
      writer.u16(event.stats.longestHopChain, "event.stats.longestHopChain");
      writer.u16(event.stats.flicksLanded, "event.stats.flicksLanded");
      writer.u16(event.stats.knifeKills, "event.stats.knifeKills");
      writer.u16(event.stats.accuracyPercent, "event.stats.accuracyPercent");
    } else if (event.stats !== undefined) {
      throw new ProtocolError("stats only valid on mode-end event");
    }
  }
  return writer.finish();
}

function encodeFrameUnchecked(frame: ProtocolFrame): Uint8Array {
  let bytes: Uint8Array;
  switch (frame.type) {
    case FrameType.Hello:
      bytes = encodeHello(frame);
      break;
    case FrameType.Refusal: {
      const writer = new Writer();
      writer.u8(FrameType.Refusal);
      writer.u8(frame.code, "refusal.code");
      bytes = writer.finish();
      break;
    }
    case FrameType.Welcome: {
      const writer = new Writer();
      writer.u8(FrameType.Welcome);
      writer.u16(frame.playerId, "playerId");
      writer.ascii(frame.roomId, MAX_ROOM_ID_BYTES, "roomId");
      writeToken(writer, frame.reconnectToken);
      writer.u16(frame.maxDatagramSize, "maxDatagramSize");
      writer.u8(frame.mode, "mode");
      writer.u8(frame.variant, "variant");
      writer.u8(frame.ladder, "ladder");
      writer.u8(frame.mapId, "mapId");
      bytes = writer.finish();
      break;
    }
    case FrameType.Cmd:
      bytes = encodeCmd(frame);
      break;
    case FrameType.Snapshot:
      bytes = encodeSnapshot(frame);
      break;
    case FrameType.BaselineAck: {
      const writer = new Writer();
      writer.u8(FrameType.BaselineAck);
      writer.u16(frame.baselineEpoch, "baselineEpoch");
      writer.u32(frame.snapshotTick, "snapshotTick");
      bytes = writer.finish();
      break;
    }
    case FrameType.Ping:
    case FrameType.Pong: {
      const writer = new Writer();
      writer.u8(frame.type);
      writer.u32(frame.nonce, "nonce");
      writer.f32(frame.clientTime, "clientTime");
      if (frame.type === FrameType.Pong) writer.u32(frame.serverTick, "serverTick");
      bytes = writer.finish();
      break;
    }
  }
  return bytes;
}

export function encodeFrame(frame: ProtocolFrame): Uint8Array {
  const bytes = encodeFrameUnchecked(frame);
  if (bytes.length > MAX_FRAME_BYTES) throw new ProtocolError("frame exceeds hard limit");
  return bytes;
}

/**
 * Serializes a candidate solely for budget probing. Callers must discard any
 * result above their negotiated ceiling; this deliberately avoids converting
 * a recoverable packing decision into a MAX_FRAME_BYTES protocol exception.
 */
export function encodeFrameForSizeProbe(frame: ProtocolFrame): Uint8Array {
  return encodeFrameUnchecked(frame);
}

function readEntity(reader: Reader): EntityDelta {
  const id = reader.u16();
  const generation = reader.u16();
  const flags = reader.u8();
  const knownFlags =
    EntityFlags.Create |
    EntityFlags.Delete |
    EntityFlags.Position |
    EntityFlags.Velocity |
    EntityFlags.Angles |
    EntityFlags.Status |
    EntityFlags.Self |
    EntityFlags.Combat;
  if ((flags & ~knownFlags) !== 0) throw new ProtocolError("unknown entity flags");
  const create = (flags & EntityFlags.Create) !== 0;
  const deleting = (flags & EntityFlags.Delete) !== 0;
  if (create && deleting) throw new ProtocolError("entity cannot be create and delete");
  if (deleting) {
    if ((flags & ~(EntityFlags.Delete | EntityFlags.Self)) !== 0) {
      throw new ProtocolError("delete delta contains state");
    }
    return { id, generation, delete: true, self: (flags & EntityFlags.Self) !== 0 };
  }
  const position = (flags & EntityFlags.Position) === 0
    ? undefined
    : {
        x: reader.f32("position.x"),
        y: reader.f32("position.y"),
        z: reader.f32("position.z"),
      };
  const velocity = (flags & EntityFlags.Velocity) === 0
    ? undefined
    : {
        x: reader.f32("velocity.x"),
        y: reader.f32("velocity.y"),
        z: reader.f32("velocity.z"),
      };
  const viewYaw = (flags & EntityFlags.Angles) === 0
    ? undefined
    : dequantizeYaw(reader.i16());
  const viewPitch = (flags & EntityFlags.Angles) === 0
    ? undefined
    : dequantizePitch(reader.i16());
  const status = (flags & EntityFlags.Status) === 0 ? undefined : reader.u8();
  if (status !== undefined && (status & ~7) !== 0) throw new ProtocolError("unknown status bits");
  let kind: EntityDelta["kind"];
  let health: number | undefined;
  let weaponTier: number | undefined;
  let ammo: number | undefined;
  let ownerId: number | undefined;
  let fireCmdSeq: number | undefined;
  let weaponId: number | undefined;
  if ((flags & EntityFlags.Combat) !== 0) {
    const decodedKind = reader.u8();
    if (decodedKind === EntityKind.Player) {
      kind = EntityKind.Player;
      health = reader.u8();
      weaponTier = reader.u8();
      ammo = reader.u8();
    } else if (decodedKind === EntityKind.Projectile) {
      kind = EntityKind.Projectile;
      ownerId = reader.u16();
      fireCmdSeq = reader.u32();
      weaponId = reader.u8();
    } else {
      throw new ProtocolError("unknown entity kind");
    }
  }
  if (create && (
    position === undefined ||
    velocity === undefined ||
    kind === undefined ||
    (kind === EntityKind.Player && (
      viewYaw === undefined || viewPitch === undefined || status === undefined ||
      health === undefined || weaponTier === undefined || ammo === undefined
    )) ||
    (kind === EntityKind.Projectile && (
      ownerId === undefined || fireCmdSeq === undefined || weaponId === undefined
    ))
  )) {
    throw new ProtocolError("create delta is incomplete");
  }
  return {
    id,
    generation,
    ...(create ? { create: true } : {}),
    ...((flags & EntityFlags.Self) !== 0 ? { self: true } : {}),
    ...(position === undefined ? {} : { position }),
    ...(velocity === undefined ? {} : { velocity }),
    ...(viewYaw === undefined ? {} : { viewYaw }),
    ...(viewPitch === undefined ? {} : { viewPitch }),
    ...(status === undefined
      ? {}
      : {
          grounded: (status & 1) !== 0,
          alive: (status & 2) !== 0,
          ducked: (status & 4) !== 0,
        }),
    ...(kind === undefined ? {} : { kind }),
    ...(health === undefined ? {} : { health }),
    ...(weaponTier === undefined ? {} : { weaponTier }),
    ...(ammo === undefined ? {} : { ammo }),
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(fireCmdSeq === undefined ? {} : { fireCmdSeq }),
    ...(weaponId === undefined ? {} : { weaponId }),
  };
}

function decodeHello(reader: Reader): HelloFrame {
  const protocolVersion = reader.u16();
  const buildHash = reader.ascii(MAX_BUILD_HASH_BYTES, "buildHash");
  const joinKind = reader.u8() as HelloFrame["joinKind"];
  const mode = reader.u8() as HelloFrame["mode"];
  const variant = reader.u8() as HelloFrame["variant"];
  const ladder = reader.u8() as HelloFrame["ladder"];
  const mapPreference = reader.u8() as HelloFrame["mapPreference"];
  const name = reader.ascii(MAX_PLAYER_NAME_BYTES, "name");
  const roomId = reader.ascii(MAX_ROOM_ID_BYTES, "roomId");
  const reconnectToken = readToken(reader);
  reader.done();
  return {
    type: FrameType.Hello,
    protocolVersion,
    buildHash,
    joinKind,
    mode,
    variant,
    ladder,
    mapPreference,
    name,
    roomId,
    reconnectToken,
  };
}

function decodeCmd(reader: Reader, length: number): CmdFrame {
  if (length !== CMD_BYTES) throw new ProtocolError("cmd has invalid length");
  const frame: CmdFrame = {
    type: FrameType.Cmd,
    seq: reader.u32(),
    tick: reader.u32(),
    buttons: reader.u16(),
    viewYaw: dequantizeYaw(reader.i16()),
    viewPitch: clampPitch(dequantizePitch(reader.i16())),
    fireFraction: reader.u8(),
    lastSnapshotTick: reader.u32(),
    interpTargetTick: reader.u32(),
    interpTargetFraction: reader.u8(),
    baselineEpoch: reader.u16(),
  };
  reader.done();
  return frame;
}

function decodeSnapshot(reader: Reader): SnapshotFrame {
  const flags = reader.u8();
  if ((flags & ~(SnapshotFlags.Full | SnapshotFlags.ModeState)) !== 0) {
    throw new ProtocolError("unknown snapshot flags");
  }
  const tick = reader.u32();
  const lastProcessedCmdSeq = reader.u32();
  const cmdArrivalMargin = reader.i8();
  const baselineEpoch = reader.u16();
  const baselineTick = reader.u32();
  const entityCount = reader.u8();
  const eventCount = reader.u8();
  if (entityCount > MAX_ENTITY_DELTAS) throw new ProtocolError("too many entity deltas");
  if (eventCount > MAX_EVENTS) throw new ProtocolError("too many events");
  let modeState: SnapshotFrame["modeState"];
  if ((flags & SnapshotFlags.ModeState) !== 0) {
    const mode = reader.u8() as NonNullable<SnapshotFrame["modeState"]>["mode"];
    const ladder = reader.u8() as NonNullable<SnapshotFrame["modeState"]>["ladder"];
    const mapId = reader.u8() as NonNullable<SnapshotFrame["modeState"]>["mapId"];
    const roundState = reader.u8();
    const winnerId = reader.u16();
    const restartTicksRemaining = reader.u16();
    const teamScores = [reader.u8(), reader.u8()] as const;
    const scoreboardCount = reader.u8();
    if (scoreboardCount > 12) throw new ProtocolError("too many scoreboard entries");
    const scoreboard = [];
    for (let index = 0; index < scoreboardCount; index += 1) {
      scoreboard.push({
        playerId: reader.u16(),
        name: reader.ascii(MAX_PLAYER_NAME_BYTES, "scoreboard.name"),
        kills: reader.u16(),
        deaths: reader.u16(),
        team: reader.u8(),
        tier: reader.u8(),
        bot: reader.u8() === 1,
      });
    }
    modeState = { mode, ladder, mapId, roundState, winnerId, restartTicksRemaining, teamScores, scoreboard };
  }
  const entities: EntityDelta[] = [];
  for (let index = 0; index < entityCount; index += 1) entities.push(readEntity(reader));
  const events = [];
  for (let index = 0; index < eventCount; index += 1) {
    const event = {
      id: reader.u32(),
      tick: reader.u32(),
      kind: reader.u8(),
      actorId: reader.u16(),
      targetId: reader.u16(),
      amount: reader.u16(),
      weaponId: reader.u8(),
      flags: reader.u8(),
    };
    events.push(event.kind === EventKind.ModeEnd
      ? {
          ...event,
          stats: {
            airshots: reader.u16(),
            topSpeedDeci: reader.u16(),
            longestHopChain: reader.u16(),
            flicksLanded: reader.u16(),
            knifeKills: reader.u16(),
            accuracyPercent: reader.u16(),
          },
        }
      : event);
  }
  reader.done();
  return {
    type: FrameType.Snapshot,
    full: (flags & SnapshotFlags.Full) !== 0,
    tick,
    lastProcessedCmdSeq,
    cmdArrivalMargin,
    baselineEpoch,
    baselineTick,
    entities,
    events,
    ...(modeState === undefined ? {} : { modeState }),
  };
}

export function decodeFrame(bytes: Uint8Array): ProtocolFrame {
  if (bytes.length === 0) throw new ProtocolError("empty frame");
  if (bytes.length > MAX_FRAME_BYTES) throw new ProtocolError("frame exceeds hard limit");
  const reader = new Reader(bytes);
  const type = reader.u8();
  switch (type) {
    case FrameType.Hello:
      if (bytes.length > MAX_HELLO_BYTES) throw new ProtocolError("hello exceeds hard limit");
      return decodeHello(reader);
    case FrameType.Refusal: {
      const frame: RefusalFrame = {
        type: FrameType.Refusal,
        code: reader.u8() as RefusalFrame["code"],
      };
      reader.done();
      return frame;
    }
    case FrameType.Welcome: {
      const frame: WelcomeFrame = {
        type: FrameType.Welcome,
        playerId: reader.u16(),
        roomId: reader.ascii(MAX_ROOM_ID_BYTES, "roomId"),
        reconnectToken: readToken(reader),
        maxDatagramSize: reader.u16(),
        mode: reader.u8() as WelcomeFrame["mode"],
        variant: reader.u8() as WelcomeFrame["variant"],
        ladder: reader.u8() as WelcomeFrame["ladder"],
        mapId: reader.u8() as WelcomeFrame["mapId"],
      };
      reader.done();
      return frame;
    }
    case FrameType.Cmd:
      return decodeCmd(reader, bytes.length);
    case FrameType.Snapshot:
      return decodeSnapshot(reader);
    case FrameType.BaselineAck: {
      const frame: BaselineAckFrame = {
        type: FrameType.BaselineAck,
        baselineEpoch: reader.u16(),
        snapshotTick: reader.u32(),
      };
      reader.done();
      return frame;
    }
    case FrameType.Ping: {
      const frame: PingFrame = {
        type: FrameType.Ping,
        nonce: reader.u32(),
        clientTime: reader.f32("clientTime"),
      };
      reader.done();
      return frame;
    }
    case FrameType.Pong: {
      const frame: PongFrame = {
        type: FrameType.Pong,
        nonce: reader.u32(),
        clientTime: reader.f32("clientTime"),
        serverTick: reader.u32(),
      };
      reader.done();
      return frame;
    }
    default:
      throw new ProtocolError(`unknown frame type ${type}`);
  }
}
