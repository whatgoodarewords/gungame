import { MapId, type ValueOf } from "@gungame/protocol";
import type { MapAabb, Vec3 } from "@gungame/shared";

export interface GhostSample extends Vec3 {
  readonly timeMs: number;
}

export interface GhostLap {
  readonly version: 1;
  readonly mapId: ValueOf<typeof MapId>;
  readonly durationMs: number;
  readonly samples: readonly GhostSample[];
}

export interface BhopRoute {
  readonly mapId: ValueOf<typeof MapId>;
  readonly startGate: MapAabb;
  readonly checkpoints: readonly MapAabb[];
}

export const BHOP_TRIAL_TIMEOUT_MS = 90_000;
export const BHOP_ROUTE_MARGIN_M = 12;

export type BhopAbortReason = "death" | "timeout" | "leave-radius";

const gate = (x: number, y: number, z: number, radius = 2.2): MapAabb => ({
  min: { x: x - radius, y: y - 1, z: z - radius },
  max: { x: x + radius, y: y + 3, z: z + radius },
});

export const BHOP_ROUTES: Readonly<Record<ValueOf<typeof MapId>, BhopRoute>> = Object.freeze({
  [MapId.Cascade]: {
    mapId: MapId.Cascade,
    startGate: gate(0, 2, 20, 2.8),
    checkpoints: [gate(20, 5, 0, 3.5), gate(0, 8, -20, 3.5), gate(-20, 5, 0, 3.5)],
  },
  [MapId.Foundry]: {
    mapId: MapId.Foundry,
    startGate: gate(-18, 0, -16),
    checkpoints: [gate(0, -2, -4, 3), gate(18, 0, 14, 3), gate(-18, 0, 14, 3)],
  },
  [MapId.Duna]: {
    mapId: MapId.Duna,
    startGate: gate(-42, 0, -12, 3),
    checkpoints: [gate(0, 0, -29, 4), gate(42, 0, -11, 3), gate(0, 0, 27, 4)],
  },
  [MapId.Spire]: {
    mapId: MapId.Spire,
    startGate: gate(-34, 10, -10, 3),
    checkpoints: [gate(0, 4, -20, 4), gate(34, 10, 10, 3), gate(0, 4, 20, 4)],
  },
});

function inside(point: Vec3, bounds: MapAabb): boolean {
  return point.x >= bounds.min.x && point.x <= bounds.max.x &&
    point.y >= bounds.min.y && point.y <= bounds.max.y &&
    point.z >= bounds.min.z && point.z <= bounds.max.z;
}

export function serializeGhost(lap: GhostLap): string {
  return JSON.stringify(lap);
}

export function deserializeGhost(value: string | null, mapId: ValueOf<typeof MapId>): GhostLap | undefined {
  if (value === null) return undefined;
  try {
    const lap = JSON.parse(value) as GhostLap;
    if (lap.version !== 1 || lap.mapId !== mapId || !Number.isFinite(lap.durationMs) ||
      lap.durationMs <= 0 || !Array.isArray(lap.samples) || lap.samples.length < 2 ||
      lap.samples.some((sample) => !Number.isFinite(sample.timeMs) ||
        !Number.isFinite(sample.x) || !Number.isFinite(sample.y) || !Number.isFinite(sample.z))) {
      return undefined;
    }
    return lap;
  } catch {
    return undefined;
  }
}

export class BhopTimeTrial {
  readonly route: BhopRoute;
  private readonly storage: Pick<Storage, "getItem" | "setItem">;
  private readonly storageKey: string;
  private armed = false;
  private startedAt: number | undefined;
  private checkpoint = 0;
  private recording: GhostSample[] = [];
  private best: GhostLap | undefined;

  constructor(route: BhopRoute, storage: Pick<Storage, "getItem" | "setItem">) {
    this.route = route;
    this.storage = storage;
    this.storageKey = `gg:bhop-best:${route.mapId}`;
    this.best = deserializeGhost(storage.getItem(this.storageKey), route.mapId);
  }

  get bestLap(): GhostLap | undefined {
    return this.best;
  }

  update(position: Vec3, nowMs: number, alive = true): {
    readonly visible: boolean;
    readonly active: boolean;
    readonly elapsedMs: number;
    readonly bestMs?: number;
    readonly ghost?: Vec3;
    readonly completed?: boolean;
    readonly aborted?: BhopAbortReason;
  } {
    const inStart = inside(position, this.route.startGate);
    let aborted: BhopAbortReason | undefined;
    if (this.startedAt !== undefined) {
      const elapsed = nowMs - this.startedAt;
      aborted = !alive
        ? "death"
        : elapsed >= BHOP_TRIAL_TIMEOUT_MS
          ? "timeout"
          : this.insideRouteEnvelope(position)
            ? undefined
            : "leave-radius";
      if (aborted !== undefined) this.reset();
    }
    if (this.startedAt === undefined) {
      if (alive && inStart) this.armed = true;
      else if (this.armed) {
        this.armed = false;
        this.startedAt = nowMs;
        this.checkpoint = 0;
        this.recording = [{ timeMs: 0, ...position }];
      }
    }
    let completed = false;
    if (this.startedAt !== undefined) {
      const elapsed = nowMs - this.startedAt;
      const last = this.recording.at(-1);
      if (last === undefined || elapsed - last.timeMs >= 32) {
        this.recording.push({ timeMs: elapsed, ...position });
      }
      const next = this.route.checkpoints[this.checkpoint];
      if (next !== undefined && inside(position, next)) this.checkpoint += 1;
      if (this.checkpoint === this.route.checkpoints.length && inStart && elapsed >= 1_000) {
        const lap: GhostLap = {
          version: 1,
          mapId: this.route.mapId,
          durationMs: Math.round(elapsed),
          samples: this.recording,
        };
        if (this.best === undefined || lap.durationMs < this.best.durationMs) {
          this.best = lap;
          this.storage.setItem(this.storageKey, serializeGhost(lap));
        }
        this.reset();
        completed = true;
      }
    }
    const elapsedMs = this.startedAt === undefined ? 0 : nowMs - this.startedAt;
    const result = {
      visible: alive && (inStart || this.startedAt !== undefined),
      active: this.startedAt !== undefined,
      elapsedMs,
      ...(this.best === undefined ? {} : { bestMs: this.best.durationMs }),
      ...(completed ? { completed: true } : {}),
      ...(aborted === undefined ? {} : { aborted }),
    };
    const ghost = this.sampleBest(elapsedMs);
    return ghost === undefined ? result : { ...result, ghost };
  }

  private insideRouteEnvelope(position: Vec3): boolean {
    const bounds = [this.route.startGate, ...this.route.checkpoints];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const entry of bounds) {
      minX = Math.min(minX, entry.min.x);
      minY = Math.min(minY, entry.min.y);
      minZ = Math.min(minZ, entry.min.z);
      maxX = Math.max(maxX, entry.max.x);
      maxY = Math.max(maxY, entry.max.y);
      maxZ = Math.max(maxZ, entry.max.z);
    }
    return position.x >= minX - BHOP_ROUTE_MARGIN_M &&
      position.y >= minY - BHOP_ROUTE_MARGIN_M &&
      position.z >= minZ - BHOP_ROUTE_MARGIN_M &&
      position.x <= maxX + BHOP_ROUTE_MARGIN_M &&
      position.y <= maxY + BHOP_ROUTE_MARGIN_M &&
      position.z <= maxZ + BHOP_ROUTE_MARGIN_M;
  }

  private reset(): void {
    this.armed = false;
    this.startedAt = undefined;
    this.checkpoint = 0;
    this.recording = [];
  }

  private sampleBest(elapsedMs: number): Vec3 | undefined {
    const lap = this.best;
    if (lap === undefined || this.startedAt === undefined) return undefined;
    const time = Math.min(lap.durationMs, elapsedMs);
    let rightIndex = lap.samples.findIndex((sample) => sample.timeMs >= time);
    if (rightIndex < 0) rightIndex = lap.samples.length - 1;
    const right = lap.samples[rightIndex];
    const left = lap.samples[Math.max(0, rightIndex - 1)];
    if (left === undefined || right === undefined) return undefined;
    const range = Math.max(1, right.timeMs - left.timeMs);
    const alpha = Math.max(0, Math.min(1, (time - left.timeMs) / range));
    return {
      x: left.x + (right.x - left.x) * alpha,
      y: left.y + (right.y - left.y) * alpha,
      z: left.z + (right.z - left.z) * alpha,
    };
  }
}
