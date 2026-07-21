// Camera recoil kick (combat-juice-spec J1). A DISPLAY-ONLY offset composed
// into the camera rotation at render time: it never touches input angles,
// never enters a Cmd, never reaches the sim — server spread remains the only
// accuracy truth, and mouse counter-control is automatic because the offset
// decays on its own and cannot fight the mouse.
//
// Deterministic by contract: no RNG. Lateral sign alternates by shot index.
// Apply: ~25 ms ease-out to peak (a 0-frame step aliases against frame cadence
// and reads as jitter, not punch). Recovery: critically-damped exponential —
// no overshoot, overshoot is aim noise.

import { WEAPONS, WeaponId, type WeaponIdValue } from "@gungame/shared";
import { sprayOffsetDegrees } from "@gungame/sim";

interface KickSpec {
  /** Vertical kick per shot, degrees (positive = muzzle rises). */
  readonly pitchDeg: number;
  /** Lateral kick magnitude per shot, degrees (sign alternates per shot). */
  readonly yawDeg: number;
  /** Time to recover 90% of the offset, ms. */
  readonly recover90Ms: number;
}

const NO_KICK: KickSpec = { pitchDeg: 0, yawDeg: 0, recover90Ms: 1 };

// Per-weapon table from combat-juice-spec.md §J1. Semis fully recover before
// their next possible shot; autos plateau ≤0.35° under held fire so the
// crosshair never lies by more than the bloom it already displays.
const KICKS: Readonly<Record<number, KickSpec>> = Object.freeze({
  [WeaponId.Pistol]: { pitchDeg: 0.55, yawDeg: 0.10, recover90Ms: 110 },
  [WeaponId.Smg]: { pitchDeg: 0.20, yawDeg: 0.06, recover90Ms: 70 },
  [WeaponId.Shotgun]: { pitchDeg: 1.50, yawDeg: 0.20, recover90Ms: 160 },
  [WeaponId.Rifle]: { pitchDeg: 0.28, yawDeg: 0.08, recover90Ms: 80 },
  [WeaponId.Scout]: { pitchDeg: 2.00, yawDeg: 0.15, recover90Ms: 200 },
  [WeaponId.Knife]: NO_KICK, // wrist-flick lives on the viewmodel; kick on a swing is noise
  [WeaponId.Sidewinder]: { pitchDeg: 0.50, yawDeg: 0.10, recover90Ms: 105 },
  [WeaponId.Boomstick]: { pitchDeg: 1.80, yawDeg: 0.25, recover90Ms: 180 },
  [WeaponId.Arc]: NO_KICK, // per-tick beam: any kick integrates to drift
  [WeaponId.Peacemaker]: { pitchDeg: 1.20, yawDeg: 0, recover90Ms: 150 },
  [WeaponId.Discus]: { pitchDeg: 0.45, yawDeg: 0.12, recover90Ms: 100 },
  [WeaponId.Deadeye]: { pitchDeg: 1.70, yawDeg: 0.15, recover90Ms: 180 },
  [WeaponId.Goldie]: { pitchDeg: 2.40, yawDeg: 0.30, recover90Ms: 220 },
});

const DEG = Math.PI / 180;
/** Scoped zoom is fov×0.45 ≈ 2.2× magnification; ×0.45 keeps APPARENT kick constant. */
const ADS_SCALE = 0.45;
/** Ease-in time constant: current reaches ~95% of target in ~25 ms. */
const APPLY_TAU_MS = 8;
/** recover90Ms → exponential time constant (90% decay = ln 10 ≈ 2.303 taus). */
const LN10 = Math.log(10);

export class CameraKick {
  private targetPitch = 0;
  private targetYaw = 0;
  private appliedPitch = 0;
  private appliedYaw = 0;
  private decayTauMs = 100;
  private shotIndex = 0;

  /**
   * Register one fired shot (from the predicted-sim presentation queue).
   * Spray-pattern weapons take their kick from the SAME table the server
   * rotates bullets by (delta between consecutive burst entries), so
   * counter-steering the camera compensates the true bullet path — the CS
   * spray-control contract. Non-pattern weapons keep the fixed table.
   */
  fire(weaponId: WeaponIdValue, scoped: boolean, burstIndex = 0): void {
    const kick = KICKS[weaponId] ?? NO_KICK;
    const weapon = WEAPONS[weaponId];
    const scale = scoped ? ADS_SCALE : 1;
    if (weapon !== undefined && weapon.sprayPattern.length > 0) {
      const here = sprayOffsetDegrees(weapon, burstIndex);
      const prev = sprayOffsetDegrees(weapon, burstIndex - 1);
      // Pattern rotates the bullet up/right by (yaw,pitch); the camera rises
      // by the same delta so the player's counter-pull cancels both.
      this.targetPitch += Math.max(0.05, here[1] - prev[1]) * DEG * scale;
      this.targetYaw += (here[0] - prev[0]) * DEG * scale;
      this.decayTauMs = Math.max(1, kick.recover90Ms / LN10);
      this.shotIndex += 1;
      return;
    }
    if (kick.pitchDeg === 0 && kick.yawDeg === 0) return;
    this.shotIndex += 1;
    this.targetPitch += kick.pitchDeg * DEG * scale;
    this.targetYaw += kick.yawDeg * DEG * scale * (this.shotIndex % 2 === 0 ? -1 : 1);
    this.decayTauMs = Math.max(1, kick.recover90Ms / LN10);
  }

  /** Advance ramps and return nothing; read pitchOffset/yawOffset after. */
  update(dtMs: number): void {
    const dt = Math.max(0, dtMs);
    // Target decays toward zero (recovery)…
    const decay = Math.exp(-dt / this.decayTauMs);
    this.targetPitch *= decay;
    this.targetYaw *= decay;
    // …while the applied offset chases the target (the 25 ms punch-in).
    const chase = 1 - Math.exp(-dt / APPLY_TAU_MS);
    this.appliedPitch += (this.targetPitch - this.appliedPitch) * chase;
    this.appliedYaw += (this.targetYaw - this.appliedYaw) * chase;
  }

  /** Radians, added to camera pitch at render time (muzzle-rise positive). */
  get pitchOffset(): number {
    return this.appliedPitch;
  }

  /** Radians, added to camera yaw at render time. */
  get yawOffset(): number {
    return this.appliedYaw;
  }
}
