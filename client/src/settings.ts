import type { WeaponDefinition } from "../../packages/shared/src/index.js";

export const USER_SETTINGS_STORAGE_KEY = "gg:settings";

export interface CrosshairSettings {
  readonly size: number;
  readonly gap: number;
  readonly dot: boolean;
  readonly color: "white" | "cyan" | "green" | "amber";
}

export interface UserSettings {
  readonly fov: number;
  readonly masterVolume: number;
  readonly muted: boolean;
  readonly crosshair: CrosshairSettings;
}

export const DEFAULT_USER_SETTINGS: UserSettings = Object.freeze({
  fov: 105,
  masterVolume: 0.8,
  muted: false,
  crosshair: Object.freeze({
    size: 6,
    gap: 4,
    dot: true,
    color: "white",
  }),
});

const COLORS: readonly CrosshairSettings["color"][] = ["white", "cyan", "green", "amber"];

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

export function loadUserSettings(storage: Pick<Storage, "getItem">): UserSettings {
  const raw = storage.getItem(USER_SETTINGS_STORAGE_KEY);
  if (raw === null) return DEFAULT_USER_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    const crosshair = parsed.crosshair as Partial<CrosshairSettings> | undefined;
    return {
      fov: clamp(parsed.fov, 90, 120, DEFAULT_USER_SETTINGS.fov),
      masterVolume: clamp(parsed.masterVolume, 0, 1, DEFAULT_USER_SETTINGS.masterVolume),
      muted: typeof parsed.muted === "boolean" ? parsed.muted : DEFAULT_USER_SETTINGS.muted,
      crosshair: {
        size: clamp(crosshair?.size, 3, 14, DEFAULT_USER_SETTINGS.crosshair.size),
        gap: clamp(crosshair?.gap, 0, 16, DEFAULT_USER_SETTINGS.crosshair.gap),
        dot: typeof crosshair?.dot === "boolean"
          ? crosshair.dot
          : DEFAULT_USER_SETTINGS.crosshair.dot,
        color: COLORS.includes(crosshair?.color as CrosshairSettings["color"])
          ? crosshair!.color as CrosshairSettings["color"]
          : DEFAULT_USER_SETTINGS.crosshair.color,
      },
    };
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

export function saveUserSettings(
  storage: Pick<Storage, "setItem">,
  settings: UserSettings,
): void {
  storage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function crosshairGapPixels(
  settings: CrosshairSettings,
  weapon: WeaponDefinition,
  scoped: boolean,
  viewportHeight: number,
  fovDegrees: number,
): number {
  if (scoped) return 0;
  const spread = weapon.spreadDegrees;
  if (spread <= 0) return settings.gap;
  const projection = viewportHeight / (2 * Math.tan(fovDegrees * Math.PI / 360));
  return Math.min(48, settings.gap + Math.tan(spread * Math.PI / 180) * projection);
}

export function pingTone(roundTripMs: number): "normal" | "amber" | "red" {
  if (roundTripMs > 200) return "red";
  if (roundTripMs > 120) return "amber";
  return "normal";
}

export function weaponTypeIcon(kind: WeaponDefinition["kind"]): string {
  if (kind === "projectile") return "◆";
  if (kind === "melee") return "⌁";
  if (kind === "beam") return "═";
  return "•";
}
