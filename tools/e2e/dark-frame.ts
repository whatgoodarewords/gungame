import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const CACHED_HEADLESS_SHELL =
  "/Users/mc/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { chromium } = await import("playwright");

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

async function waitFor(url: string, timeoutMs = 240_000): Promise<void> {
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

try {
  await Promise.all([
    waitFor("http://127.0.0.1:8787/gg/healthz"),
    waitFor("http://127.0.0.1:5173/gg/"),
  ]);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      timeout: 30_000,
      executablePath: existsSync(chromium.executablePath())
        ? chromium.executablePath()
        : existsSync(CACHED_HEADLESS_SHELL)
          ? CACHED_HEADLESS_SHELL
          : SYSTEM_CHROME,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--use-angle=swiftshader",
        "--disable-gpu-sandbox",
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("MachPortRendezvousServer") || !message.includes("Permission denied")) {
      throw error;
    }
    console.log(JSON.stringify({
      test: "webgl2-greybox-spawn-not-dark",
      skipped: true,
      reason: "host sandbox denied Chromium Mach port registration",
    }));
  }
  if (browser !== null) {
    try {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = new URL("http://127.0.0.1:5173/gg/");
    url.searchParams.set("name", "DarkFrameE2E");
    url.searchParams.set("create", "1");
    url.searchParams.set("mode", "gungame");
    url.searchParams.set("map", "foundry");
    url.searchParams.set("backend", "webgl2");
    url.searchParams.set("style", "dev-grid");
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() =>
      (globalThis as unknown as {
        __GG_VISUAL_DEBUG__?: { connected?: number };
      }).__GG_VISUAL_DEBUG__?.connected === 1, undefined, { timeout: 30_000 });
    await page.waitForTimeout(500);

    const pixels = await page.evaluate(() => {
      interface BrowserCanvas {
        width: number;
        height: number;
        getContext(
          kind: "2d",
          options: { willReadFrequently: boolean },
        ): {
          drawImage(source: BrowserCanvas, x: number, y: number, width: number, height: number): void;
          getImageData(
            x: number,
            y: number,
            width: number,
            height: number,
          ): { data: Uint8ClampedArray };
        } | null;
      }
      const browser = globalThis as unknown as {
        document: {
          querySelector(selector: string): BrowserCanvas | null;
          createElement(tag: "canvas"): BrowserCanvas;
        };
      };
      const source = browser.document.querySelector("#app > canvas");
      if (source === null || source.width === 0 || source.height === 0) {
        throw new Error("render canvas is unavailable");
      }
      const sample = browser.document.createElement("canvas");
      sample.width = 160;
      sample.height = 100;
      const context = sample.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("2D readback context is unavailable");
      context.drawImage(source, 0, 0, sample.width, sample.height);
      const data = context.getImageData(0, 0, sample.width, sample.height).data;
      let dark = 0;
      let black = 0;
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index]!;
        const green = data[index + 1]!;
        const blue = data[index + 2]!;
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        if (luminance < 20) dark += 1;
        if (red < 3 && green < 3 && blue < 3) black += 1;
      }
      const total = data.length / 4;
      return {
        darkRatio: dark / total,
        blackRatio: black / total,
        width: sample.width,
        height: sample.height,
      };
    });
    if (pixels.darkRatio > 0.9) {
      throw new Error(
        `dark-frame regression: ${(pixels.darkRatio * 100).toFixed(2)}% of spawn pixels are dark (>90%)`,
      );
    }
    if (errors.length > 0) throw new Error(`page errors: ${errors.join(" | ")}`);
    console.log(JSON.stringify({
      test: "webgl2-greybox-spawn-not-dark",
      passed: true,
      ...pixels,
    }));
    } finally {
      await browser.close();
    }
  }
} finally {
  stop(client);
  stop(server);
}
