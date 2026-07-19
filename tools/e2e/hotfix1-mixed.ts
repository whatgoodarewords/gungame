import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { GameMode, GravityVariant, Ladder, MapPreference } from "@gungame/protocol";
import { loadGameplayMap } from "@gungame/shared";
import { CollisionWorld } from "@gungame/sim";
import type { Browser, Page } from "playwright";

import { HeadlessBot } from "../netsim/bot.js";

const ROOT = new URL("../../", import.meta.url);
const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DURATION_MS = Number.parseInt(process.env.HOTFIX1_DURATION_MS ?? "90000", 10);
const BOT_COUNT = 12;
const BROWSER_COUNT = 2;

if (!Number.isFinite(DURATION_MS) || DURATION_MS < 1_000) {
  throw new RangeError("HOTFIX1_DURATION_MS must be at least 1000");
}

function start(
  command: readonly string[],
  environment: NodeJS.ProcessEnv,
  output: string[],
): ChildProcess {
  const child = spawn(command[0]!, command.slice(1), {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  }
  return child;
}

function stop(child: ChildProcess): void {
  if (child.pid === undefined || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function deadline<T>(promise: Promise<T>, label: string, timeoutMs = 15_000): Promise<T> {
  return Promise.race([
    promise,
    delay(timeoutMs).then(() => {
      throw new Error(`${label} timed out after ${timeoutMs} ms`);
    }),
  ]);
}

async function waitFor(url: string, timeoutMs = 90_000): Promise<void> {
  const expires = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < expires) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastError)}`);
}

async function createBotRoom(
  firstId: number,
  count: number,
  world: CollisionWorld,
): Promise<HeadlessBot[]> {
  const first = new HeadlessBot({
    id: firstId,
    url: "ws://127.0.0.1:8787/gg/ws",
    world,
    seed: 0x484f5400 + firstId,
    mode: GameMode.GunGame,
    variant: GravityVariant.Scoutz,
    ladder: Ladder.Arsenal,
    mapPreference: MapPreference.Foundry,
    create: true,
  });
  first.start();
  await deadline(first.ready, `bot ${firstId} baseline`);
  const rest = Array.from({ length: count - 1 }, (_, index) => new HeadlessBot({
    id: firstId + index + 1,
    url: "ws://127.0.0.1:8787/gg/ws",
    world,
    seed: 0x484f5400 + firstId + index + 1,
    mode: GameMode.GunGame,
    variant: GravityVariant.Scoutz,
    ladder: Ladder.Arsenal,
    mapPreference: MapPreference.Foundry,
    roomId: first.joinedRoomId,
  }));
  for (const bot of rest) bot.start();
  await deadline(Promise.all(rest.map((bot) => bot.ready)), `room ${first.joinedRoomId} bots`);
  return [first, ...rest];
}

async function openBrowserPlayer(
  browser: Browser,
  roomId: string,
  backend: "webgpu" | "webgl2",
  closeLogs: string[],
): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (error) => closeLogs.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.text().includes("websocket closed")) closeLogs.push(message.text());
  });
  const url = new URL("http://127.0.0.1:5173/gg/");
  url.searchParams.set("name", `Hotfix_${backend}`);
  url.searchParams.set("room", roomId);
  url.searchParams.set("backend", backend);
  url.searchParams.set("visualtest", "1");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    (globalThis as unknown as {
      __GG_VISUAL_DEBUG__?: { connected?: number };
  }).__GG_VISUAL_DEBUG__?.connected === 1, undefined, { timeout: 30_000 });
  await page.locator(".resume-overlay").click();
  await page.waitForFunction(() => {
    const scope = globalThis as unknown as {
      document: {
        pointerLockElement: unknown;
        querySelector(selector: string): unknown;
      };
    };
    const canvas = scope.document.querySelector("#app canvas:last-of-type");
    return canvas !== null && scope.document.pointerLockElement === canvas;
  }, undefined, { timeout: 10_000 });
  return page;
}

async function exerciseCombinedInput(page: Page, lateral: "KeyA" | "KeyD"): Promise<void> {
  const beforeYaw = await page.evaluate(() =>
    Number((globalThis as unknown as {
      __GG_VISUAL_DEBUG__?: { inputYaw?: number };
    }).__GG_VISUAL_DEBUG__?.inputYaw ?? 0));
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("Space");
  await page.keyboard.down(lateral);
  await page.evaluate(() => {
    const scope = globalThis as unknown as {
      MouseEvent: new (type: string, init: { bubbles: boolean }) => object;
      document: { dispatchEvent(event: object): void };
    };
    const event = new scope.MouseEvent("mousemove", { bubbles: true });
    Object.defineProperties(event, {
      movementX: { value: 24 },
      movementY: { value: -6 },
    });
    scope.document.dispatchEvent(event);
  });
  await page.waitForFunction(({ yaw, sideBit }) => {
    const debug = (globalThis as unknown as {
      __GG_VISUAL_DEBUG__?: {
        inputButtons?: number;
        inputLocked?: number;
        inputYaw?: number;
      };
    }).__GG_VISUAL_DEBUG__;
    const buttons = debug?.inputButtons ?? 0;
    return debug?.inputLocked === 1 &&
      (buttons & 64) !== 0 &&
      (buttons & 16) !== 0 &&
      (buttons & sideBit) !== 0 &&
      debug?.inputYaw !== yaw;
  }, { yaw: beforeYaw, sideBit: lateral === "KeyA" ? 4 : 8 });
  await page.keyboard.up(lateral);
  await page.keyboard.up("Space");
  await page.keyboard.up("ShiftLeft");
}

function dockerLogs(container: string, since: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      ["logs", "--since", since, container],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`docker logs failed: ${error.message}`));
          return;
        }
        resolve(`${stdout}${stderr}`);
      },
    );
  });
}

const serverOutput: string[] = [];
const clientOutput: string[] = [];
const closeLogs: string[] = [];
const startedAt = new Date().toISOString();
const server = start(
  ["pnpm", "--filter", "@gungame/server", "dev"],
  { ALLOW_HEADLESS_BOTS: "1", BUILD_HASH: "dev", PORT: "8787" },
  serverOutput,
);
const client = start(
  ["pnpm", "--filter", "@gungame/client", "dev", "--host", "127.0.0.1", "--port", "5173"],
  {},
  clientOutput,
);
const bots: HeadlessBot[] = [];
let browser: Browser | undefined;

try {
  await Promise.all([
    waitFor("http://127.0.0.1:8787/gg/healthz"),
    waitFor("http://127.0.0.1:5173/gg/"),
  ]);
  const map = loadGameplayMap(readFileSync(new URL("../../maps/foundry.blob", import.meta.url)));
  const world = new CollisionWorld(map.collision, map.killVolumes);
  const [firstRoom, secondRoom] = await Promise.all([
    createBotRoom(100, BOT_COUNT / 2, world),
    createBotRoom(200, BOT_COUNT / 2, world),
  ]);
  bots.push(...firstRoom, ...secondRoom);

  const { chromium } = await import("playwright");
  browser = await chromium.launch({
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
  const pages = await Promise.all([
    openBrowserPlayer(browser, firstRoom[0]!.joinedRoomId, "webgpu", closeLogs),
    openBrowserPlayer(browser, secondRoom[0]!.joinedRoomId, "webgl2", closeLogs),
  ]);
  for (const page of pages) {
    await page.click("#settings-toggle");
    await page.selectOption("#gg-style", "brutalist-approx");
  }
  await exerciseCombinedInput(pages[0]!, "KeyA");
  await exerciseCombinedInput(pages[0]!, "KeyD");
  const inspector = await pages[0]!.locator("#gg-input-events li").allTextContents();
  if (inspector.length !== 5) {
    throw new Error(`input inspector retained ${inspector.length} events instead of 5`);
  }

  await delay(Math.floor(DURATION_MS / 2));
  for (const page of pages) await page.selectOption("#gg-style", "dev-grid");
  await delay(Math.ceil(DURATION_MS / 2));

  for (const [index, page] of pages.entries()) {
    const debug = await page.evaluate(() =>
      (globalThis as unknown as {
        __GG_VISUAL_DEBUG__?: Record<string, number | string>;
      }).__GG_VISUAL_DEBUG__);
    if (debug?.connected !== 1 || debug.inputLocked !== 1 || debug.style !== "dev-grid") {
      throw new Error(`browser ${index + 1} did not survive: ${JSON.stringify(debug)}`);
    }
  }
  if (closeLogs.length !== 0) throw new Error(closeLogs.join(" | "));
  const botFailures = bots.flatMap((bot, index) => {
    const metrics = bot.metrics();
    return metrics.protocolErrors === 0 && metrics.reconnectCount === 0
      ? []
      : [`bot ${index + 1}: ${JSON.stringify(metrics)}`];
  });
  if (botFailures.length !== 0) throw new Error(botFailures.join(" | "));
  if (server.exitCode !== null || server.signalCode !== null) {
    throw new Error(`server exited during mixed run: ${server.exitCode ?? server.signalCode}`);
  }

  const localLogs = serverOutput.join("");
  const listens = localLogs.match(/gungame server listening/g)?.length ?? 0;
  if (listens !== 1) throw new Error(`local server listen count ${listens}\n${localLogs}`);
  if (/FSM time must be finite|uncaught|authoritative loop (?:step|sweep) error/i.test(localLogs)) {
    throw new Error(`server failure signature in logs\n${localLogs}`);
  }

  const dockerContainer = process.env.HOTFIX1_DOCKER_CONTAINER;
  if (dockerContainer !== undefined && dockerContainer !== "") {
    const logs = await dockerLogs(dockerContainer, startedAt);
    const dockerListens = logs.match(/gungame server listening/g)?.length ?? 0;
    if (dockerListens > 1 || /FSM time must be finite|uncaught/i.test(logs)) {
      throw new Error(`docker restart/failure signature detected\n${logs}`);
    }
  }

  console.log(JSON.stringify({
    bots: BOT_COUNT,
    browsers: BROWSER_COUNT,
    durationSeconds: DURATION_MS / 1_000,
    pointerLock: "engaged",
    styles: ["brutalist-approx", "dev-grid"],
    inputMatrix: ["Shift+Space+A+mouse", "Shift+Space+D+mouse"],
    websocketCloses: closeLogs.length,
    serverListenCount: listens,
    dockerLogs: process.env.HOTFIX1_DOCKER_CONTAINER === undefined ? "not requested" : "checked",
  }));
} finally {
  for (const bot of bots) bot.stop();
  await browser?.close();
  stop(client);
  stop(server);
}
