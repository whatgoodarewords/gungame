import crowbarUrl from "../../assets/vendor/creative-trio-crowbar/crowbar.glb?url";
import footstepConcrete0Url from "../../assets/vendor/kenney-impact/selected/footstep_concrete_000.ogg?url";
import footstepConcrete1Url from "../../assets/vendor/kenney-impact/selected/footstep_concrete_001.ogg?url";
import impactGenericUrl from "../../assets/vendor/kenney-impact/selected/impactGeneric_light_000.ogg?url";
import impactMetalUrl from "../../assets/vendor/kenney-impact/selected/impactMetal_heavy_000.ogg?url";
import uiClickUrl from "../../assets/vendor/kenney-interface/selected/click_001.ogg?url";
import uiConfirmUrl from "../../assets/vendor/kenney-interface/selected/confirmation_001.ogg?url";
import uiErrorUrl from "../../assets/vendor/kenney-interface/selected/error_001.ogg?url";
import explosionUrl from "../../assets/vendor/kenney-sci-fi/selected/explosionCrunch_000.ogg?url";
import forceFieldUrl from "../../assets/vendor/kenney-sci-fi/selected/forceField_000.ogg?url";
import laserLargeUrl from "../../assets/vendor/kenney-sci-fi/selected/laserLarge_000.ogg?url";
import laserRetroUrl from "../../assets/vendor/kenney-sci-fi/selected/laserRetro_000.ogg?url";
import laserSmallUrl from "../../assets/vendor/kenney-sci-fi/selected/laserSmall_000.ogg?url";
import bayonetUrl from "../../assets/vendor/quaternius-ultimate-guns/bayonet.glb?url";
import boomstickUrl from "../../assets/vendor/quaternius-ultimate-guns/boomstick.glb?url";
import deadeyeUrl from "../../assets/vendor/quaternius-ultimate-guns/deadeye.glb?url";
import goldieUrl from "../../assets/vendor/quaternius-ultimate-guns/goldie.glb?url";
import pistolUrl from "../../assets/vendor/quaternius-ultimate-guns/pistol.glb?url";
import rifleUrl from "../../assets/vendor/quaternius-ultimate-guns/rifle.glb?url";
import scoutUrl from "../../assets/vendor/quaternius-ultimate-guns/scout.glb?url";
import shotgunUrl from "../../assets/vendor/quaternius-ultimate-guns/shotgun.glb?url";
import sidewinderUrl from "../../assets/vendor/quaternius-ultimate-guns/sidewinder.glb?url";
import smgUrl from "../../assets/vendor/quaternius-ultimate-guns/smg.glb?url";
import { WeaponId, type WeaponIdValue } from "../../packages/shared/src/index.js";

export const WEAPON_MODEL_URLS: Partial<Readonly<Record<WeaponIdValue, string>>> = Object.freeze({
  [WeaponId.Pistol]: pistolUrl,
  [WeaponId.Smg]: smgUrl,
  [WeaponId.Shotgun]: shotgunUrl,
  [WeaponId.Rifle]: rifleUrl,
  [WeaponId.Scout]: scoutUrl,
  [WeaponId.Knife]: crowbarUrl || bayonetUrl,
  [WeaponId.Sidewinder]: sidewinderUrl,
  [WeaponId.Boomstick]: boomstickUrl,
  [WeaponId.Deadeye]: deadeyeUrl,
  [WeaponId.Goldie]: goldieUrl,
});

export const AUDIO_SAMPLE_URLS = Object.freeze({
  footstepConcrete: [footstepConcrete0Url, footstepConcrete1Url],
  impactGeneric: impactGenericUrl,
  impactMetal: impactMetalUrl,
  uiClick: uiClickUrl,
  uiConfirm: uiConfirmUrl,
  uiError: uiErrorUrl,
  explosion: explosionUrl,
  forceField: forceFieldUrl,
  laserLarge: laserLargeUrl,
  laserRetro: laserRetroUrl,
  laserSmall: laserSmallUrl,
});
