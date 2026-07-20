import {
  DEFAULT_FEEL,
  loadGameplayMap,
  TICK_DT,
  WEAPONS,
  WeaponId,
  ladderWeapons,
  type WeaponIdValue,
  type FeelParams,
  type GameplayMap,
} from "../../packages/shared/src/index.js";
import {
  CollisionWorld,
  createInitialState,
  type Cmd,
  type MoveParams,
  type State,
  DEFAULT,
  SCOUTZ,
} from "../../packages/sim/src/index.js";
import {
  EntityKind,
  GameMode,
  GravityVariant,
  Ladder,
  MapId,
  RoundState,
  type SnapshotEvent,
  type SnapshotModeState,
} from "../../packages/protocol/src/index.js";
import {
  NetworkSession,
  PredictionReconciler,
  type InterpolatedEntity,
} from "./net/index.js";
import { OffRenderTickDriver } from "./tick-driver.js";

export interface FrameInput {
  readonly buttons: number;
  readonly viewYaw: number;
  readonly viewPitch: number;
  readonly fireFraction?: number;
  readonly lastSnapshotTick?: number;
  readonly interpTargetTick?: number;
  readonly interpTargetFraction?: number;
}

export interface SimHandle {
  step(): void;
  getState(): State;
  /** State one tick behind, for render interpolation. */
  getPrevState(): State;
  getRenderPosition(dtSeconds: number): State["player"]["position"];
  getRemotePlayers(nowMs: number): readonly InterpolatedEntity[];
  /** Fraction [0,1) of the current tick elapsed, for render interpolation. */
  getAlpha(nowMs?: number): number;
  setParams(params: MoveParams): void;
  setFeel(feel: FeelParams): void;
  applyInput(frameInput: FrameInput): void;
  /** Pull-at-tick input source: consumes pulses exactly once per sim tick (144 Hz safe). */
  setTickInput(source: () => FrameInput): void;
  getCombatState(): CombatView;
  drainCombatEvents(): readonly SnapshotEvent[];
  /**
   * Weapons fired by the predicted sim since the last drain, in tick order —
   * the ONLY authority for local fire presentation (muzzle/audio/casing).
   * Melee-modifier attacks resolve to the knife here, matching the server. (F2)
   */
  drainFirePresentations(): readonly WeaponIdValue[];
  getPingMs(): number;
  /** Command-pipeline health for the stuck-diagnostics chip. */
  getNetStats(): { readonly sentCmds: number; readonly ackedCmdSeq: number };
}

export interface CombatView {
  readonly selfId: number;
  readonly generation: number;
  readonly health: number;
  readonly alive: boolean;
  readonly tier: number;
  readonly ammo: number;
  readonly weaponId: WeaponIdValue;
  readonly modeState?: SnapshotModeState;
  readonly predictedProjectiles: ReturnType<PredictionReconciler["reconcileProjectiles"]>;
}

export interface PlaygroundOptions {
  readonly initialMapUrl?: string;
  readonly mapUrlForMode?: (mode: typeof GameMode[keyof typeof GameMode]) => string;
  readonly mapUrlForMap?: (mapId: typeof MapId[keyof typeof MapId]) => string;
  readonly onMapLoaded?: (
    map: GameplayMap,
    mode: typeof GameMode[keyof typeof GameMode],
    mapId: typeof MapId[keyof typeof MapId],
  ) => void;
  readonly onWelcome?: (
    mode: typeof GameMode[keyof typeof GameMode],
    variant: typeof GravityVariant[keyof typeof GravityVariant],
    ladder: typeof Ladder[keyof typeof Ladder],
    mapId: typeof MapId[keyof typeof MapId],
    roomId: string,
  ) => void;
  readonly onRefusal?: (code: number) => void;
  readonly onClose?: (code: number, reason: string) => void;
}

const EMPTY_INPUT: FrameInput = Object.freeze({
  buttons: 0,
  viewYaw: 0,
  viewPitch: 0,
});

export function createPlayground(
  canvas: HTMLCanvasElement,
  blobUrlOrOptions?: string | PlaygroundOptions,
): { sim: SimHandle } {
  // The bridge deliberately treats the canvas as an opaque ownership token.
  void canvas;
  const options: PlaygroundOptions = typeof blobUrlOrOptions === "string"
    ? { initialMapUrl: blobUrlOrOptions }
    : (blobUrlOrOptions ?? {});

  let state = createInitialState();
  let prevState = state;
  let world: CollisionWorld | undefined;
  let prediction: PredictionReconciler | undefined;
  let network: NetworkSession | undefined;
  let nextSeq = 1;
  let params: MoveParams = DEFAULT;
  let feel: FeelParams = DEFAULT_FEEL;
  let input = EMPTY_INPUT;
  let tickDriver: OffRenderTickDriver | undefined;
  let welcomeMode: typeof GameMode[keyof typeof GameMode] = GameMode.GunGame;
  let welcomeLadder: typeof Ladder[keyof typeof Ladder] = Ladder.Classic;
  let welcomeMapId: typeof MapId[keyof typeof MapId] = MapId.Foundry;
  let combat: CombatView = {
    selfId: 0,
    generation: 0,
    health: 100,
    alive: true,
    tier: 1,
    ammo: 0,
    weaponId: WeaponId.Pistol,
    predictedProjectiles: [],
  };
  const combatEvents: SnapshotEvent[] = [];

  let lastAckedCmdSeq = 0;
  let tickInput: (() => FrameInput) | undefined;
  const tick = (): void => {
    if (world === undefined) return;
    if (tickInput !== undefined) input = { ...tickInput() };
    prevState = state;
    const cmd: Cmd = {
      seq: nextSeq,
      tick: state.tick,
      buttons: input.buttons,
      viewYaw: input.viewYaw,
      viewPitch: input.viewPitch,
      fireFraction: input.fireFraction ?? 0,
      lastSnapshotTick: input.lastSnapshotTick ?? 0,
      interpTargetTick: input.interpTargetTick ?? 0,
      interpTargetFraction: input.interpTargetFraction ?? 0,
    };
    nextSeq += 1;
    if (prediction === undefined) return;
    if (combat.alive) state = prediction.predict(cmd);
    network?.sendCommand(cmd, performance.now());
  };

  const sim: SimHandle = {
    step: tick,
    getState: () => state,
    getPrevState: () => prevState,
    getRenderPosition: (dtSeconds) =>
      prediction?.renderPosition(dtSeconds) ?? state.player.position,
    getRemotePlayers: (nowMs) => network?.remoteEntities(nowMs) ?? [],
    getAlpha: (nowMs = performance.now()) => tickDriver?.alphaAt(nowMs) ?? 0,
    setParams: (nextParams) => {
      params = { ...nextParams };
      prediction?.configure(params, feel);
    },
    setFeel: (nextFeel) => {
      feel = { ...nextFeel };
      prediction?.configure(params, feel);
    },
    applyInput: (frameInput) => {
      input = { ...frameInput };
    },
    setTickInput: (source) => {
      tickInput = source;
    },
    getCombatState: () => combat,
    drainCombatEvents: () => combatEvents.splice(0),
    drainFirePresentations: () => prediction?.drainFirePresentations() ?? [],
    getPingMs: () => network?.clock.roundTripMs ?? 0,
    getNetStats: () => ({ sentCmds: nextSeq - 1, ackedCmdSeq: lastAckedCmdSeq }),
  };

  let mapLoadSequence = 0;
  let requestedMapUrl = "";
  const installMap = async (
    url: string,
    mode: typeof GameMode[keyof typeof GameMode],
    mapId: typeof MapId[keyof typeof MapId],
    placeAtSpawn: boolean,
  ): Promise<void> => {
    const sequence = ++mapLoadSequence;
    requestedMapUrl = url;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`map load failed: HTTP ${response.status}`);
    const map = loadGameplayMap(await response.arrayBuffer());
    if (sequence !== mapLoadSequence) return;
    world = new CollisionWorld(map.collision, map.killVolumes);
    if (placeAtSpawn) {
      const spawn = map.spawns[0];
      state = createInitialState();
      if (spawn !== undefined) {
        state = {
          ...state,
          player: {
            ...state.player,
            position: { ...spawn.position },
            viewYaw: (spawn.yaw * 180) / Math.PI,
          },
        };
      }
    }
    prediction = new PredictionReconciler(state, world);
    prediction.configure(params, feel);
    options.onMapLoaded?.(map, mode, mapId);
  };

  const initialMode = new URLSearchParams(location.search).get("mode") === "gungame"
    ? GameMode.GunGame
    : GameMode.Scoutzknivez;
  const mapQuery = new URLSearchParams(location.search).get("map");
  const initialMapId = initialMode === GameMode.Scoutzknivez
    ? MapId.Spire
    : mapQuery === "duna"
      ? MapId.Duna
      : mapQuery === "cascade"
        ? MapId.Cascade
        : MapId.Foundry;
  const initialUrl = options.initialMapUrl ?? options.mapUrlForMap?.(initialMapId) ??
    options.mapUrlForMode?.(initialMode) ??
    new URL("../../maps/spire.blob", import.meta.url).toString();

  void installMap(initialUrl, initialMode, initialMapId, true)
    .then(() => {
      network = new NetworkSession({
        onRefusal: (code) => options.onRefusal?.(code),
        onClose: (code, reason) => options.onClose?.(code, reason),
        onWelcome: (mode, variant, ladder, mapId, roomId) => {
          welcomeMode = mode;
          welcomeLadder = ladder;
          welcomeMapId = mapId;
          params = mode === GameMode.Scoutzknivez || variant === GravityVariant.Scoutz
            ? SCOUTZ
            : DEFAULT;
          prediction?.configure(params, feel);
          options.onWelcome?.(mode, variant, ladder, mapId, roomId);
          const nextMapUrl = options.mapUrlForMap?.(mapId) ?? options.mapUrlForMode?.(mode);
          if (nextMapUrl !== undefined && nextMapUrl !== requestedMapUrl) {
            void installMap(nextMapUrl, mode, mapId, false).catch((error: unknown) => console.error(error));
          }
        },
        onSnapshot: ({ frame, entities, resetPrediction, events }) => {
          const snapshotMapId = frame.modeState?.mapId;
          if (snapshotMapId !== undefined && snapshotMapId !== welcomeMapId) {
            welcomeMapId = snapshotMapId;
            const nextMapUrl = options.mapUrlForMap?.(snapshotMapId);
            if (nextMapUrl !== undefined && nextMapUrl !== requestedMapUrl) {
              void installMap(nextMapUrl, welcomeMode, snapshotMapId, false)
                .catch((error: unknown) => console.error(error));
            }
          }
          lastAckedCmdSeq = Math.max(lastAckedCmdSeq, frame.lastProcessedCmdSeq);
          const self = entities.find((entity) =>
            entity.id === network?.selfId && entity.kind === EntityKind.Player);
          if (self === undefined || prediction === undefined) return;
          const authoritative: State = {
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
          prevState = prediction.state;
          const generationChanged = combat.generation !== 0 && combat.generation !== self.generation;
          if (resetPrediction || generationChanged) prediction.resetForEpoch(authoritative);
          else prediction.reconcile(authoritative, frame.lastProcessedCmdSeq);
          const weaponId = welcomeMode === GameMode.Scoutzknivez
            ? WeaponId.Scout
            : ladderWeapons(welcomeLadder)[Math.max(0, self.weaponTier - 1)] ?? WeaponId.Pistol;
          prediction.configureCombat(self.id, self.generation, weaponId);
          prediction.setPresentationGates(
            frame.modeState?.roundState === RoundState.ScoreboardFreeze,
            WEAPONS[weaponId].magazine > 0 && self.ammo <= 0,
          );
          const predictedProjectiles = prediction.reconcileProjectiles(entities);
          combat = {
            selfId: self.id,
            generation: self.generation,
            health: self.health,
            alive: self.alive,
            tier: self.weaponTier,
            ammo: self.ammo,
            weaponId,
            ...(frame.modeState === undefined ? {} : { modeState: frame.modeState }),
            predictedProjectiles,
          };
          combatEvents.push(...events);
          state = prediction.state;
        },
      });
    })
    .catch((error: unknown) => {
      console.error(error);
    });

  tickDriver = new OffRenderTickDriver(tick);
  tickDriver.start();

  return { sim };
}
