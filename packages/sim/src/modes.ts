import {
  LadderId,
  SCOREBOARD_FREEZE_TICKS,
  SCOUTZ_SCORE_LIMIT,
  ladderWeapons,
  type LadderIdValue,
} from "@gungame/shared";

export const CombatMode = { GunGame: 0, Scoutzknivez: 1 } as const;
export type CombatModeValue = typeof CombatMode[keyof typeof CombatMode];

export interface ModePlayer {
  readonly id: number;
  tier: number;
  team: 0 | 1 | 2;
  kills: number;
  deaths: number;
}

export interface ModeKillInput {
  readonly attackerId: number;
  readonly victimId: number;
  readonly melee: boolean;
  readonly suicide: boolean;
  /** True is informative only: posthumous projectile kills deliberately score. */
  readonly posthumous?: boolean;
}

export interface ModeKillResult {
  readonly attackerAdvanced: boolean;
  readonly victimDemoted: boolean;
  readonly winnerId: number;
  readonly suicide: boolean;
  readonly counted: boolean;
}

export interface ModeSnapshot {
  readonly mode: CombatModeValue;
  readonly ladder: LadderIdValue;
  readonly winnerId: number;
  readonly restartTick: number;
  readonly teamScores: readonly [number, number];
}

export class ModeRules {
  readonly players = new Map<number, ModePlayer>();
  readonly mode: CombatModeValue;
  readonly ladder: LadderIdValue;
  private scores: [number, number] = [0, 0];
  private winner = 0;
  private restartAt = 0;

  constructor(mode: CombatModeValue, ladder: LadderIdValue = LadderId.Classic) {
    this.mode = mode;
    this.ladder = ladder;
  }

  get frozen(): boolean {
    return this.winner !== 0;
  }

  get snapshot(): ModeSnapshot {
    return {
      mode: this.mode,
      ladder: this.ladder,
      winnerId: this.winner,
      restartTick: this.restartAt,
      teamScores: [...this.scores],
    };
  }

  addPlayer(id: number): ModePlayer {
    const tier = this.mode === CombatMode.GunGame ? this.lateJoinTier() : 1;
    const team = this.mode === CombatMode.Scoutzknivez ? this.smallerTeam() : 0;
    const player: ModePlayer = { id, tier, team, kills: 0, deaths: 0 };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id: number): readonly ModePlayer[] {
    this.players.delete(id);
    return this.rebalanceTeams();
  }

  /** trailing parity minus one, with tier numbers one-based and clamped to 1. */
  lateJoinTier(): number {
    if (this.players.size === 0) return 1;
    const trailing = Math.min(...[...this.players.values()].map((player) => player.tier));
    return Math.max(1, trailing - 1);
  }

  recordKill(input: ModeKillInput, tick: number): ModeKillResult {
    const attacker = this.players.get(input.attackerId);
    const victim = this.players.get(input.victimId);
    if (victim !== undefined) victim.deaths += 1;
    if (input.suicide || attacker === undefined || victim === undefined || this.frozen) {
      return {
        attackerAdvanced: false,
        victimDemoted: false,
        winnerId: this.winner,
        suicide: input.suicide,
        counted: false,
      };
    }
    attacker.kills += 1;
    if (this.mode === CombatMode.Scoutzknivez) {
      if (attacker.team === 1 || attacker.team === 2) {
        if (attacker.team === 1) this.scores[0] += 1;
        else this.scores[1] += 1;
        const score = attacker.team === 1 ? this.scores[0] : this.scores[1];
        if (score >= SCOUTZ_SCORE_LIMIT) {
          this.winner = attacker.id;
          this.restartAt = tick + SCOREBOARD_FREEZE_TICKS;
        }
      }
      return {
        attackerAdvanced: false,
        victimDemoted: false,
        winnerId: this.winner,
        suicide: false,
        counted: true,
      };
    }
    const ladderLength = ladderWeapons(this.ladder).length;
    const finalTierKill = attacker.tier >= ladderLength && input.melee;
    if (finalTierKill) {
      this.winner = attacker.id;
      this.restartAt = tick + SCOREBOARD_FREEZE_TICKS;
    } else {
      attacker.tier = Math.min(ladderLength, attacker.tier + 1);
    }
    const victimDemoted = input.melee && victim.tier > 1;
    if (victimDemoted) victim.tier -= 1;
    return {
      attackerAdvanced: !finalTierKill,
      victimDemoted,
      winnerId: this.winner,
      suicide: false,
      counted: true,
    };
  }

  shouldRestart(tick: number): boolean {
    return this.restartAt !== 0 && tick >= this.restartAt;
  }

  restart(): void {
    this.scores = [0, 0];
    this.winner = 0;
    this.restartAt = 0;
    for (const player of this.players.values()) {
      player.tier = 1;
      player.kills = 0;
      player.deaths = 0;
    }
    this.rebalanceTeams();
  }

  rebalanceTeams(): readonly ModePlayer[] {
    if (this.mode !== CombatMode.Scoutzknivez) return [];
    const moved: ModePlayer[] = [];
    for (;;) {
      const one = [...this.players.values()].filter((player) => player.team === 1);
      const two = [...this.players.values()].filter((player) => player.team === 2);
      if (Math.abs(one.length - two.length) <= 1) break;
      const source = one.length > two.length ? one : two;
      const destination = one.length > two.length ? 2 : 1;
      const candidate = source.sort((left, right) => left.kills - right.kills || right.id - left.id)[0];
      if (candidate === undefined) break;
      candidate.team = destination;
      moved.push(candidate);
    }
    return moved;
  }

  private smallerTeam(): 1 | 2 {
    let one = 0;
    let two = 0;
    for (const player of this.players.values()) {
      if (player.team === 1) one += 1;
      if (player.team === 2) two += 1;
    }
    return one <= two ? 1 : 2;
  }
}
