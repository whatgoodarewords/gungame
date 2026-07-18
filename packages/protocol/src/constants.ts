export const PROTOCOL_VERSION = 2 as const;
export const MAX_FRAME_BYTES = 2_048 as const;
export const MAX_HELLO_BYTES = 256 as const;
export const SNAPSHOT_SIZE_CEILING = 1_100 as const;
export const MAX_BUILD_HASH_BYTES = 64 as const;
export const MAX_ROOM_ID_BYTES = 32 as const;
export const MAX_RECONNECT_TOKEN_BYTES = 16 as const;
export const MAX_ENTITIES = 12 as const;
export const MAX_ENTITY_DELTAS = MAX_ENTITIES * 2;
export const MAX_EVENTS = 64 as const;
export const CMD_WINDOW_SIZE = 8 as const;
export const SNAPSHOT_RING_SIZE = 64 as const;

export const FrameType = {
  Hello: 1,
  Refusal: 2,
  Welcome: 3,
  Cmd: 4,
  Snapshot: 5,
  BaselineAck: 6,
  Ping: 7,
  Pong: 8,
} as const;

export const RefusalCode = {
  VersionMismatch: 1,
  RoomFull: 2,
  RateLimited: 3,
  RoomCreateRefused: 4,
  RoomNotFound: 5,
  ProtocolError: 6,
  Backpressure: 7,
  ServerRestarting: 8,
} as const;

export const JoinKind = {
  Quickplay: 0,
  Create: 1,
  Invite: 2,
  Resume: 3,
} as const;

export const GameMode = {
  GunGame: 0,
  Scoutzknivez: 1,
} as const;

export const GravityVariant = {
  Standard: 0,
  Scoutz: 1,
} as const;

export const EntityFlags = {
  Create: 1 << 0,
  Delete: 1 << 1,
  Position: 1 << 2,
  Velocity: 1 << 3,
  Angles: 1 << 4,
  Status: 1 << 5,
  Self: 1 << 6,
} as const;

export const SnapshotFlags = {
  Full: 1 << 0,
} as const;
