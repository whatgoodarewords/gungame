import type {
  FrameType,
  GameMode,
  GravityVariant,
  JoinKind,
  Ladder,
  EntityKind,
  RefusalCode,
} from "./constants.js";

export type ValueOf<T> = T[keyof T];

export interface HelloFrame {
  readonly type: typeof FrameType.Hello;
  readonly protocolVersion: number;
  readonly buildHash: string;
  readonly joinKind: ValueOf<typeof JoinKind>;
  readonly mode: ValueOf<typeof GameMode>;
  readonly variant: ValueOf<typeof GravityVariant>;
  readonly ladder: ValueOf<typeof Ladder>;
  readonly name: string;
  readonly roomId: string;
  readonly reconnectToken: Uint8Array;
}

export interface RefusalFrame {
  readonly type: typeof FrameType.Refusal;
  readonly code: ValueOf<typeof RefusalCode>;
}

export interface WelcomeFrame {
  readonly type: typeof FrameType.Welcome;
  readonly playerId: number;
  readonly roomId: string;
  readonly reconnectToken: Uint8Array;
  readonly maxDatagramSize: number;
  readonly mode: ValueOf<typeof GameMode>;
  readonly variant: ValueOf<typeof GravityVariant>;
  readonly ladder: ValueOf<typeof Ladder>;
}

export interface CmdFrame {
  readonly type: typeof FrameType.Cmd;
  readonly seq: number;
  readonly tick: number;
  readonly buttons: number;
  readonly viewYaw: number;
  readonly viewPitch: number;
  readonly fireFraction: number;
  readonly lastSnapshotTick: number;
  readonly interpTargetTick: number;
  readonly interpTargetFraction: number;
  readonly baselineEpoch: number;
}

export interface EntityState {
  readonly id: number;
  readonly generation: number;
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly velocity: Readonly<{ x: number; y: number; z: number }>;
  readonly viewYaw: number;
  readonly viewPitch: number;
  readonly grounded: boolean;
  readonly alive: boolean;
  readonly kind: ValueOf<typeof EntityKind>;
  readonly health: number;
  readonly weaponTier: number;
  readonly ammo: number;
  readonly ownerId: number;
  readonly fireCmdSeq: number;
  readonly weaponId: number;
}

export interface EntityDelta {
  readonly id: number;
  readonly generation: number;
  readonly create?: boolean;
  readonly delete?: boolean;
  readonly self?: boolean;
  readonly position?: EntityState["position"];
  readonly velocity?: EntityState["velocity"];
  readonly viewYaw?: number;
  readonly viewPitch?: number;
  readonly grounded?: boolean;
  readonly alive?: boolean;
  readonly kind?: ValueOf<typeof EntityKind>;
  readonly health?: number;
  readonly weaponTier?: number;
  readonly ammo?: number;
  readonly ownerId?: number;
  readonly fireCmdSeq?: number;
  readonly weaponId?: number;
}

export interface SnapshotEvent {
  readonly id: number;
  readonly tick: number;
  readonly kind: number;
  readonly actorId: number;
  readonly targetId: number;
  readonly amount: number;
  readonly weaponId: number;
  readonly flags: number;
}

export interface ScoreboardEntry {
  readonly playerId: number;
  readonly kills: number;
  readonly deaths: number;
  readonly team: number;
  readonly tier: number;
}

export interface SnapshotModeState {
  readonly mode: ValueOf<typeof GameMode>;
  readonly ladder: ValueOf<typeof Ladder>;
  readonly roundState: number;
  readonly winnerId: number;
  readonly restartTicksRemaining: number;
  readonly teamScores: readonly [number, number];
  readonly scoreboard: readonly ScoreboardEntry[];
}

export interface SnapshotFrame {
  readonly type: typeof FrameType.Snapshot;
  readonly full: boolean;
  readonly tick: number;
  readonly lastProcessedCmdSeq: number;
  readonly cmdArrivalMargin: number;
  readonly baselineEpoch: number;
  readonly baselineTick: number;
  readonly entities: readonly EntityDelta[];
  readonly events: readonly SnapshotEvent[];
  readonly modeState?: SnapshotModeState;
}

export interface BaselineAckFrame {
  readonly type: typeof FrameType.BaselineAck;
  readonly baselineEpoch: number;
  readonly snapshotTick: number;
}

export interface PingFrame {
  readonly type: typeof FrameType.Ping;
  readonly nonce: number;
  readonly clientTime: number;
}

export interface PongFrame {
  readonly type: typeof FrameType.Pong;
  readonly nonce: number;
  readonly clientTime: number;
  readonly serverTick: number;
}

export type ProtocolFrame =
  | HelloFrame
  | RefusalFrame
  | WelcomeFrame
  | CmdFrame
  | SnapshotFrame
  | BaselineAckFrame
  | PingFrame
  | PongFrame;
