import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { describe, expect, it } from "vitest";

import { WeaponId, WEAPONS } from "../../packages/shared/src/index.js";
import { ProjectileVisualSystem, RemoteCharacterSystem } from "../src/combat-visuals.js";
import {
  DEFAULT_CONTROL_BINDINGS,
  loadControlBindings,
  rebindControl,
} from "../src/input.js";
import { likelyTouchOnly } from "../src/menu.js";
import {
  MAX_AUTOMATIC_RECONNECTS,
  clearReconnectAttempts,
  nextReconnectAttempt,
} from "../src/reconnect.js";
import {
  DEFAULT_USER_SETTINGS,
  crosshairGapPixels,
  loadUserSettings,
  pingTone,
  weaponTypeIcon,
} from "../src/settings.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe("phase 4c controls and settings", () => {
  it("uses mac-safe duck defaults and de-duplicates persisted rebinds", () => {
    expect(DEFAULT_CONTROL_BINDINGS.duck[0]).toBe("ShiftLeft");
    const rebound = rebindControl(DEFAULT_CONTROL_BINDINGS, "jump", "KeyW");
    expect(rebound.jump[0]).toBe("KeyW");
    expect(rebound.forward).not.toContain("KeyW");
    const storage = new MemoryStorage();
    storage.setItem("gg:controls", JSON.stringify(rebound));
    expect(loadControlBindings(storage)).toEqual(rebound);
  });

  it("clamps settings and projects crosshair spread", () => {
    const storage = new MemoryStorage();
    storage.setItem("gg:settings", JSON.stringify({
      fov: 999,
      masterVolume: -4,
      muted: true,
      crosshair: { size: 99, gap: -2, dot: false, color: "invalid" },
    }));
    const loaded = loadUserSettings(storage);
    expect(loaded.fov).toBe(120);
    expect(loaded.masterVolume).toBe(0);
    expect(loaded.crosshair.color).toBe(DEFAULT_USER_SETTINGS.crosshair.color);
    expect(crosshairGapPixels(loaded.crosshair, WEAPONS[WeaponId.Smg], false, 720, 105))
      .toBeGreaterThan(loaded.crosshair.gap);
    expect(crosshairGapPixels(loaded.crosshair, WEAPONS[WeaponId.Smg], true, 720, 105)).toBe(0);
    expect(pingTone(121)).toBe("amber");
    expect(pingTone(201)).toBe("red");
    expect(weaponTypeIcon(WEAPONS[WeaponId.Peacemaker].kind)).toBe("◆");
  });

  it("gates only touch-only coarse-pointer devices", () => {
    expect(likelyTouchOnly({ maxTouchPoints: 5 }, true)).toBe(true);
    expect(likelyTouchOnly({ maxTouchPoints: 5 }, false)).toBe(false);
    expect(likelyTouchOnly({ maxTouchPoints: 0 }, true)).toBe(false);
  });
});

describe("phase 4c reconnect and visual presence", () => {
  it("caps automatic reconnects at three and can reset the retry window", () => {
    const storage = new MemoryStorage();
    for (let attempt = 1; attempt <= MAX_AUTOMATIC_RECONNECTS; attempt += 1) {
      expect(nextReconnectAttempt(storage, attempt * 1_000).allowed).toBe(true);
    }
    expect(nextReconnectAttempt(storage, 4_000).allowed).toBe(false);
    clearReconnectAttempts(storage);
    expect(nextReconnectAttempt(storage, 5_000).attempt).toBe(1);
  });

  it("renders shared projectile meshes and articulated character rig parts", () => {
    const scene = new Scene();
    const material = new MeshBasicNodeMaterial();
    const projectiles = new ProjectileVisualSystem(scene, material);
    projectiles.update([
      { key: "rocket", weaponId: WeaponId.Peacemaker, position: { x: 1, y: 2, z: 3 } },
      { key: "disc", weaponId: WeaponId.Discus, position: { x: -1, y: 1, z: 2 } },
    ]);
    const characters = new RemoteCharacterSystem(scene, material);
    characters.update([{
      id: 2,
      generation: 3,
      position: { x: 0, y: 0, z: -2 },
      velocity: { x: 3, y: 1, z: 0 },
      grounded: false,
      alive: true,
      ducked: true,
    }], 1);
    expect(projectiles.rocketCores.count).toBe(1);
    expect(projectiles.discCores.count).toBe(1);
    expect(projectiles.smokePuffs.userData.rocketSmoke).toBe(true);
    expect(Object.values(characters.meshes)).toHaveLength(6);
    expect(Object.values(characters.meshes).every((mesh) => mesh.userData.riggedHumanoid)).toBe(true);
  });
});
