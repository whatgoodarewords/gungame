import type { MatchStats } from "@gungame/protocol";

export type MatchStatKey = keyof MatchStats;
export type PersonalBest = Readonly<Partial<Record<MatchStatKey, number>>>;

export const MATCH_STAT_KEYS = Object.freeze([
  "airshots",
  "topSpeedDeci",
  "longestHopChain",
  "flicksLanded",
  "knifeKills",
  "accuracyPercent",
] as const satisfies readonly MatchStatKey[]);

export function formatMatchStats(stats: MatchStats): readonly [string, string][] {
  return [
    ["airshots", String(stats.airshots)],
    ["top speed", `${(stats.topSpeedDeci / 10).toFixed(1)} m/s`],
    ["longest hop chain", String(stats.longestHopChain)],
    ["flicks landed", String(stats.flicksLanded)],
    ["knife kills", String(stats.knifeKills)],
    ["accuracy", `${stats.accuracyPercent}%`],
  ];
}

export function updatePersonalBest(
  storage: Pick<Storage, "getItem" | "setItem">,
  mapKey: string,
  stats: MatchStats,
): ReadonlySet<MatchStatKey> {
  const key = `gg:match-pb:${mapKey}`;
  let prior: PersonalBest = {};
  try {
    prior = JSON.parse(storage.getItem(key) ?? "{}") as PersonalBest;
  } catch {
    prior = {};
  }
  const next: Record<MatchStatKey, number> = { ...stats };
  const personalBests = new Set<MatchStatKey>();
  for (const statKey of MATCH_STAT_KEYS) {
    const oldValue = prior[statKey] ?? -1;
    if (stats[statKey] > oldValue) personalBests.add(statKey);
    next[statKey] = Math.max(oldValue, stats[statKey]);
  }
  storage.setItem(key, JSON.stringify(next));
  return personalBests;
}

export function matchStatsShareText(stats: MatchStats, mapName: string, url: string): string {
  const nouns = formatMatchStats(stats).map(([label, value]) => `${label} ${value}`).join(" · ");
  return `gungame — ${mapName.toLowerCase()} · ${nouns} · ${url}`;
}
