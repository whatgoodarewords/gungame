import type { MatchStats } from "@gungame/protocol";
import { WeaponId, type WeaponIdValue } from "@gungame/shared";

export const ROOM_BOT_TARGET = 5;
export const BOT_REACTION_TICKS = 12;
export const BOT_AIM_ERROR_DEGREES = 2.4;

export const BOT_NAMES = Object.freeze([
  "Ari", "Mika", "Noor", "Sage", "Robin",
  "Quinn", "Remy", "Jules", "Lane", "Rowan",
] as const);

export function desiredBotCount(connectedHumans: number): number {
  return Math.max(0, ROOM_BOT_TARGET - Math.max(0, Math.floor(connectedHumans)));
}

export class MatchStatTracker {
  private airshots = 0;
  private topSpeed = 0;
  private hopChain = 0;
  private longestHopChain = 0;
  private flicksLanded = 0;
  private knifeKills = 0;
  private shotsFired = 0;
  private shotsHit = 0;
  private grounded = true;

  observeMovement(speed: number, grounded: boolean): void {
    if (Number.isFinite(speed)) this.topSpeed = Math.max(this.topSpeed, Math.max(0, speed));
    if (grounded && !this.grounded) {
      this.hopChain = speed >= 6 ? this.hopChain + 1 : 0;
      this.longestHopChain = Math.max(this.longestHopChain, this.hopChain);
    }
    this.grounded = grounded;
  }

  recordShot(hit: boolean, flickDegrees: number): void {
    this.shotsFired += 1;
    if (!hit) return;
    this.recordHit(flickDegrees);
  }

  recordHit(flickDegrees = 0): void {
    this.shotsHit += 1;
    if (flickDegrees >= 25) this.flicksLanded += 1;
  }

  recordAirshot(): void {
    this.airshots += 1;
  }

  recordKnifeKill(): void {
    this.knifeKills += 1;
  }

  reset(): void {
    this.airshots = 0;
    this.topSpeed = 0;
    this.hopChain = 0;
    this.longestHopChain = 0;
    this.flicksLanded = 0;
    this.knifeKills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.grounded = true;
  }

  get snapshot(): MatchStats {
    return {
      airshots: this.airshots,
      topSpeedDeci: Math.round(this.topSpeed * 10),
      longestHopChain: this.longestHopChain,
      flicksLanded: this.flicksLanded,
      knifeKills: this.knifeKills,
      accuracyPercent: this.shotsFired === 0
        ? 0
        : Math.round(this.shotsHit / this.shotsFired * 100),
    };
  }
}

export class ImpressiveTracker {
  private chain = 0;

  recordShot(weaponId: WeaponIdValue, hit: boolean): number | undefined {
    if (weaponId !== WeaponId.Scout && weaponId !== WeaponId.Deadeye) return undefined;
    if (!hit) {
      this.chain = 0;
      return undefined;
    }
    this.chain += 1;
    return this.chain >= 2 && this.chain % 2 === 0 ? this.chain : undefined;
  }

  resetLife(): void {
    this.chain = 0;
  }
}

export function angularDeltaDegrees(left: number, right: number): number {
  const delta = ((left - right + 540) % 360) - 180;
  return Math.abs(delta);
}
