import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GameMode, GravityVariant, Ladder, MapPreference } from "@gungame/protocol";
import { loadGameplayMap } from "@gungame/shared";
import { CollisionWorld } from "@gungame/sim";
import { HeadlessBot } from "../netsim/bot.js";

const ROOT = new URL("../../", import.meta.url);
const { chromium } = await import("playwright");
const STYLE_IDS = ["dev-grid", "ink-duotone", "toon-cel", "brutalist-approx"] as const;
const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ARTIFACTS = fileURLToPath(new URL("../../client/artifacts/phase7/", import.meta.url));
mkdirSync(ARTIFACTS, { recursive: true });

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
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--use-angle=swiftshader",
      "--disable-gpu-sandbox",
      "--enable-precise-memory-info",
      "--js-flags=--expose-gc",
    ],
  });
  const receipts: Array<Record<string, unknown>> = [];
  const viewmodelShots: string[] = [];
  try {
    for (const backend of ["webgpu", "webgl2"] as const) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 20,
        downloadThroughput: 50 * 1024 * 1024 / 8,
        uploadThroughput: 10 * 1024 * 1024 / 8,
        connectionType: "wifi",
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const url = new URL("http://127.0.0.1:5173/gg/");
      url.searchParams.set("name", `E2E_${backend}`);
      url.searchParams.set("room", bot.joinedRoomId);
      url.searchParams.set("backend", backend);
      url.searchParams.set("visualtest", "1");
      const coldStartedAt = performance.now();
      await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => {
        const debug = (globalThis as unknown as {
          __GG_VISUAL_DEBUG__?: { projectileMeshes?: number; characterRigs?: number };
        }).__GG_VISUAL_DEBUG__;
        return (debug?.projectileMeshes ?? 0) > 0 && (debug?.characterRigs ?? 0) > 0;
      }, undefined, { timeout: 30_000 });
      const coldControllableMs = performance.now() - coldStartedAt;
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
        const screenshot = `${ARTIFACTS}/style-${backend}-${style}.png`;
        await page.screenshot({ path: screenshot });
        const perf = await page.evaluate(() =>
          (globalThis as unknown as { __GG_VISUAL_DEBUG__?: Record<string, number | string> })
            .__GG_VISUAL_DEBUG__);
        if (backend === "webgl2") {
          const number = (key: string): number => Number(perf?.[key] ?? Infinity);
          if (number("drawCalls") > 150) throw new Error(`draw-call budget: ${number("drawCalls")} > 150`);
          if (number("particlesMs") > 0.5) throw new Error(`particle budget: ${number("particlesMs")} > 0.5 ms`);
          if (number("charactersMs") > 1) throw new Error(`character budget: ${number("charactersMs")} > 1 ms`);
          if (coldControllableMs > 5_000) throw new Error(`cold-load budget: ${coldControllableMs} > 5000 ms`);
        }
        receipts.push({ kind: "style", backend, style, coldControllableMs, ...perf });
      }
      if (backend === "webgl2") {
        await cdp.send("HeapProfiler.enable");
        await cdp.send("HeapProfiler.collectGarbage");
        const heapBefore = await page.evaluate(() =>
          (performance as unknown as { memory?: { usedJSHeapSize: number } })
            .memory?.usedJSHeapSize ?? -1);
        const beforeIdle = await page.evaluate(() => {
          const debug = (globalThis as unknown as {
            __GG_VISUAL_DEBUG__?: { playerX?: number; playerZ?: number };
          }).__GG_VISUAL_DEBUG__;
          return { x: debug?.playerX ?? 0, z: debug?.playerZ ?? 0 };
        });
        await page.waitForTimeout(60_000);
        await cdp.send("HeapProfiler.collectGarbage");
        const heapAfter = await page.evaluate(() =>
          (performance as unknown as { memory?: { usedJSHeapSize: number } })
            .memory?.usedJSHeapSize ?? -1);
        const heapDeltaBytes = heapBefore < 0 || heapAfter < 0 ? -1 : heapAfter - heapBefore;
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
        receipts.push({
          kind: "gc-smoke",
          backend,
          durationSeconds: 60,
          heapBefore,
          heapAfter,
          heapDeltaBytes,
          passed: heapDeltaBytes >= 0 && heapDeltaBytes < 5 * 1024 * 1024,
        });
        if (heapDeltaBytes < 0 || heapDeltaBytes >= 5 * 1024 * 1024) {
          throw new Error(`60 s heap budget: ${heapDeltaBytes} bytes`);
        }

        for (let config = 0; config < 14; config += 1) {
          for (const kick of [0, 1] as const) {
            const captureUrl = new URL(url);
            captureUrl.searchParams.set("vmconfig", String(config));
            captureUrl.searchParams.set("vmkick", String(kick));
            await page.goto(captureUrl.toString(), { waitUntil: "domcontentloaded" });
            await page.waitForFunction(({ expectedConfig, expectedKick }) => {
              const debug = (globalThis as unknown as {
                __GG_VISUAL_DEBUG__?: { viewmodelConfig?: number; viewmodelKick?: number };
              }).__GG_VISUAL_DEBUG__;
              return debug?.viewmodelConfig === expectedConfig &&
                debug?.viewmodelKick === expectedKick;
            }, { expectedConfig: config, expectedKick: kick }, { timeout: 30_000 });
            await page.waitForTimeout(350);
            const shot = `${ARTIFACTS}/viewmodel-${String(config + 1).padStart(2, "0")}-${kick === 1 ? "kick" : "idle"}.png`;
            await page.screenshot({ path: shot });
            viewmodelShots.push(shot);
          }
        }
      }
      const debug = await page.evaluate(() =>
        (globalThis as unknown as { __GG_VISUAL_DEBUG__?: Record<string, number | string> })
          .__GG_VISUAL_DEBUG__);
      if (errors.length !== 0) throw new Error(`${backend} page errors: ${errors.join(" | ")}`);
      if (debug?.connected !== 1) throw new Error(`${backend} session did not survive probe`);
      console.log(JSON.stringify({ backend, styles: STYLE_IDS.length, ...debug }));
      await page.close();
    }
    if (viewmodelShots.length === 28) {
      execFileSync("magick", [
        "montage",
        ...viewmodelShots,
        "-thumbnail", "320x200",
        "-tile", "4x7",
        "-geometry", "320x200+4+18",
        "-background", "#101317",
        "-fill", "white",
        "-pointsize", "12",
        "-set", "label", "%t",
        `${ARTIFACTS}/viewmodel-contact-sheet.png`,
      ]);
    }
    writeFileSync(
      `${ARTIFACTS}/measurements.json`,
      `${JSON.stringify(receipts, null, 2)}\n`,
    );
  } finally {
    await browser.close();
  }
} finally {
  bot?.stop();
  stop(client);
  stop(server);
}
