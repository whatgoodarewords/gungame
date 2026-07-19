import { describe, expect, it } from "vitest";

import { formatMatchStats, matchStatsShareText, updatePersonalBest } from "../src/match-stats.js";

class Storage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const stats = {
  airshots: 4,
  topSpeedDeci: 312,
  longestHopChain: 9,
  flicksLanded: 2,
  knifeKills: 1,
  accuracyPercent: 41,
} as const;

describe("match-end stats presentation", () => {
  it("formats only flat nouns and persists per-map personal bests", () => {
    expect(formatMatchStats(stats)).toEqual([
      ["airshots", "4"],
      ["top speed", "31.2 m/s"],
      ["longest hop chain", "9"],
      ["flicks landed", "2"],
      ["knife kills", "1"],
      ["accuracy", "41%"],
    ]);
    const storage = new Storage();
    expect([...updatePersonalBest(storage, "cascade", stats)]).toHaveLength(6);
    expect([...updatePersonalBest(storage, "cascade", { ...stats, airshots: 3 })])
      .not.toContain("airshots");
    expect(matchStatsShareText(stats, "Cascade", "https://example.test/gg"))
      .toContain("airshots 4 · top speed 31.2 m/s");
  });
});
