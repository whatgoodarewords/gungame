import crowbarUrl from "../../assets/vendor/creative-trio-crowbar/crowbar.glb?url";
import wradArmsUrl from "../../assets/vendor/wrad-arms/arms.glb?url";
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
import pistolNearUrl from "../../assets/vendor/ffsl-firearms/pistol-1911-shot-near_A42P.ogg?url";
import pistolMidUrl from "../../assets/vendor/ffsl-firearms/pistol-1911-shot-mid_A34P.ogg?url";
import smgNearUrl from "../../assets/vendor/ffsl-firearms/smg-m45-shot-near_G31P.ogg?url";
import smgMidUrl from "../../assets/vendor/ffsl-firearms/smg-m45-shot-mid_G20P.ogg?url";
import shotgunNearUrl from "../../assets/vendor/ffsl-firearms/shotgun-nova-shot-near_O21P.ogg?url";
import shotgunMidUrl from "../../assets/vendor/ffsl-firearms/shotgun-nova-shot-mid_O17P.ogg?url";
import rifleNearUrl from "../../assets/vendor/ffsl-firearms/rifle-ar15-shot-near_D32P.ogg?url";
import rifleMidUrl from "../../assets/vendor/ffsl-firearms/rifle-ar15-shot-mid_D24P.ogg?url";
import sniperNearUrl from "../../assets/vendor/ffsl-firearms/sniper-tikka-shot-near_W29P.ogg?url";
import sniperMidUrl from "../../assets/vendor/ffsl-firearms/sniper-tikka-shot-mid_W24P.ogg?url";
import rackSlideUrl from "../../assets/vendor/freesound-cc0-weapon-foley/pistol-slide-rack_fs442560.ogg?url";
import rackPumpUrl from "../../assets/vendor/freesound-cc0-weapon-foley/shotgun-pump_fs673320.ogg?url";
import rackBoltUrl from "../../assets/vendor/freesound-cc0-weapon-foley/sniper-bolt-cycle_fs370345.ogg?url";
import equipDrawUrl from "../../assets/vendor/freesound-cc0-weapon-foley/weapon-equip-draw_fs239959.ogg?url";
import ricochet1Url from "../../assets/vendor/freesound-cc0-weapon-foley/ricochet-1_fs478345.ogg?url";
import ricochet2Url from "../../assets/vendor/freesound-cc0-weapon-foley/ricochet-2_fs394187.ogg?url";
import { WeaponId, type WeaponIdValue } from "../../packages/shared/src/index.js";

export const WRAD_ARMS_URL = wradArmsUrl;

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

/** Real field-recorded gunshots (FFSL, CC0): near = local player, mid = remote/positional. */
export const GUNSHOT_SAMPLE_URLS: Partial<Readonly<Record<WeaponIdValue, { near: string; mid: string }>>> =
  Object.freeze({
    [WeaponId.Pistol]: { near: pistolNearUrl, mid: pistolMidUrl },
    [WeaponId.Sidewinder]: { near: pistolNearUrl, mid: pistolMidUrl },
    [WeaponId.Smg]: { near: smgNearUrl, mid: smgMidUrl },
    [WeaponId.Shotgun]: { near: shotgunNearUrl, mid: shotgunMidUrl },
    [WeaponId.Boomstick]: { near: shotgunNearUrl, mid: shotgunMidUrl },
    [WeaponId.Rifle]: { near: rifleNearUrl, mid: rifleMidUrl },
    [WeaponId.Scout]: { near: sniperNearUrl, mid: sniperMidUrl },
    [WeaponId.Deadeye]: { near: sniperNearUrl, mid: sniperMidUrl },
    [WeaponId.Goldie]: { near: sniperNearUrl, mid: sniperMidUrl },
  });

/** Weapon-handling foley (freesound CC0). */
export const FOLEY_SAMPLE_URLS = Object.freeze({
  rackSlide: rackSlideUrl,
  rackPump: rackPumpUrl,
  rackBolt: rackBoltUrl,
  equipDraw: equipDrawUrl,
  ricochets: [ricochet1Url, ricochet2Url],
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
