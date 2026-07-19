import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { GameMode, GravityVariant, Ladder, MapPreference } from "@gungame/protocol";
import { loadGameplayMap } from "@gungame/shared";
import { CollisionWorld } from "@gungame/sim";
import { HeadlessBot } from "../netsim/bot.js";

const ROOT = new URL("../../", import.meta.url);
const { chromium } = await import("playwright");
const STYLE_IDS = ["dev-grid", "ink-duotone", "toon-cel", "brutalist-approx"] as const;
const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function start(command: readonly string[], environment: NodeJS.ProcessEnv = {}): ChildProcess {
  return spawn(command[0]!, command.slice(1), {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
}

function stop(child: ChildProcess): void {
  if (child.pid === undefined || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function waitFor(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastError)}`);
}

const server = start(
  ["pnpm", "--filter", "@gungame/server", "dev"],
  { ALLOW_HEADLESS_BOTS: "1", BUILD_HASH: "dev", PORT: "8787" },
);
const client = start(
  ["pnpm", "--filter", "@gungame/client", "dev", "--host", "127.0.0.1", "--port", "5173"],
);
let bot: HeadlessBot | undefined;

try {
  await Promise.all([
    waitFor("http://127.0.0.1:8787/gg/healthz"),
    waitFor("http://127.0.0.1:5173/gg/"),
  ]);
  const map = loadGameplayMap(readFileSync(new URL("../../maps/foundry.blob", import.meta.url)));
  bot = new HeadlessBot({
    id: 91,
    url: "ws://127.0.0.1:8787/gg/ws",
    world: new CollisionWorld(map.collision, map.killVolumes),
    seed: 0x4c4f4144,
    mode: GameMode.GunGame,
    variant: GravityVariant.Scoutz,
    ladder: Ladder.Arsenal,
    mapPreference: MapPreference.Foundry,
    create: true,
  });
  bot.start();
  await Promise.race([
    bot.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("visual bot did not join")), 10_000)),
  ]);

  const browser = await chromium.launch({
    headless: true,
    timeout: 30_000,
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH === undefined && existsSync(SYSTEM_CHROME)
      ? { executablePath: SYSTEM_CHROME }
      : {}),
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--use-angle=swiftshader",
      "--disable-gpu-sandbox",
    ],
  });
  try {
    for (const backend of ["webgpu", "webgl2"] as const) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const url = new URL("http://127.0.0.1:5173/gg/");
      url.searchParams.set("name", `E2E_${backend}`);
      url.searchParams.set("room", bot.joinedRoomId);
      url.searchParams.set("backend", backend);
      url.searchParams.set("visualtest", "1");
      await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => {
        const debug = (globalThis as unknown as {
          __GG_VISUAL_DEBUG__?: { projectileMeshes?: number; characterRigs?: number };
        }).__GG_VISUAL_DEBUG__;
        return (debug?.projectileMeshes ?? 0) > 0 && (debug?.characterRigs ?? 0) > 0;
      }, undefined, { timeout: 30_000 });
      await page.locator(".resume-overlay").click();
      await page.waitForFunction(() => {
        const scope = globalThis as unknown as {
          document: {
            pointerLockElement: unknown;
            querySelector(selector: string): unknown;
          };
        };
        return scope.document.pointerLockElement ===
          scope.document.querySelector("#app canvas:last-of-type");
      }, undefined, { timeout: 10_000 });
      await page.click("#settings-toggle");
      for (const style of STYLE_IDS) {
        await page.selectOption("#gg-style", style);
        await page.waitForFunction((expected) =>
          (globalThis as unknown as { __GG_VISUAL_DEBUG__?: { style?: string } })
            .__GG_VISUAL_DEBUG__?.style === expected, style);
        await page.waitForTimeout(80);
      }
      if (backend === "webgpu") {
        const beforeIdle = await page.evaluate(() => {
          const debug = (globalThis as unknown as {
            __GG_VISUAL_DEBUG__?: { playerX?: number; playerZ?: number };
          }).__GG_VISUAL_DEBUG__;
          return { x: debug?.playerX ?? 0, z: debug?.playerZ ?? 0 };
        });
        await page.waitForTimeout(45_000);
        await page.selectOption("#gg-style", "dev-grid");
        await page.waitForFunction(() =>
          (globalThis as unknown as { __GG_VISUAL_DEBUG__?: { style?: string } })
            .__GG_VISUAL_DEBUG__?.style === "dev-grid");
        await page.waitForTimeout(45_000);
        await page.keyboard.down("KeyW");
        await page.waitForTimeout(350);
        await page.keyboard.up("KeyW");
        await page.waitForFunction(({ x, z }) => {
          const debug = (globalThis as unknown as {
            __GG_VISUAL_DEBUG__?: {
              connected?: number;
              playerX?: number;
              playerZ?: number;
            };
          }).__GG_VISUAL_DEBUG__;
          return debug?.connected === 1 &&
            Math.hypot((debug.playerX ?? x) - x, (debug.playerZ ?? z) - z) > 0.01;
        }, beforeIdle, { timeout: 10_000 });
      }
      const debug = await page.evaluate(() =>
        (globalThis as unknown as { __GG_VISUAL_DEBUG__?: Record<string, number | string> })
          .__GG_VISUAL_DEBUG__);
      if (errors.length !== 0) throw new Error(`${backend} page errors: ${errors.join(" | ")}`);
      if (debug?.connected !== 1) throw new Error(`${backend} session did not survive probe`);
      console.log(JSON.stringify({ backend, styles: STYLE_IDS.length, ...debug }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  bot?.stop();
  stop(client);
  stop(server);
}
