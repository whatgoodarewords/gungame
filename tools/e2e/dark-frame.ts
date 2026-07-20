import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { chromium } = await import("playwright");

// Software rasterisation (swiftshader) segfaults on Apple Silicon; ANGLE Metal
// is the only backend that survives a headless launch there. Linux CI has no
// Metal, so it keeps swiftshader.
const ANGLE_BACKENDS = process.env.GG_ANGLE
  ? [process.env.GG_ANGLE]
  : process.platform === "darwin"
    ? ["metal", "swiftshader"]
    : ["swiftshader"];

function browserExecutable(): string {
  const override = process.env.GG_BROWSER_PATH;
  if (override !== undefined && existsSync(override)) return override;
  // Honours PLAYWRIGHT_BROWSERS_PATH; never hardcode a machine-specific cache.
  const resolved = chromium.executablePath();
  return existsSync(resolved) ? resolved : SYSTEM_CHROME;
}

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
  let launchFailure = "";
  for (const angle of ANGLE_BACKENDS) {
    try {
      browser = await chromium.launch({
        headless: true,
        timeout: 60_000,
        executablePath: browserExecutable(),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          `--use-angle=${angle}`,
          "--disable-gpu-sandbox",
          "--enable-unsafe-webgpu",
        ],
      });
      break;
    } catch (error) {
      launchFailure = `angle=${angle}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (browser === null) {
    // A host that cannot launch a GPU-backed browser must not be able to mark
    // this suite green by accident: local dev may skip, CI never does.
    const strict = process.env.CI !== undefined || process.env.GG_E2E_STRICT === "1";
    if (strict) throw new Error(`dark-frame could not launch a browser (${launchFailure})`);
    console.log(JSON.stringify({
      test: "webgl2-webgpu-greybox-spawn-not-dark-with-environment",
      skipped: true,
      reason: launchFailure || "no usable browser",
    }));
  }
  if (browser !== null) {
    try {
    for (const backend of ["webgl2", "webgpu"] as const) {
      const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
      const errors: string[] = [];
      const consoleDiagnostics: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") {
          consoleDiagnostics.push(`${message.type()}: ${message.text()}`);
        }
      });
      const url = new URL("http://127.0.0.1:5173/gg/");
      url.searchParams.set("name", `DarkFrame-${backend}`);
      url.searchParams.set("create", "1");
      url.searchParams.set("mode", "gungame");
      url.searchParams.set("map", "foundry");
      if (backend === "webgl2") url.searchParams.set("backend", "webgl2");
      url.searchParams.set("style", "dev-grid");
      await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() =>
        (globalThis as unknown as {
          __GG_VISUAL_DEBUG__?: { connected?: number };
        }).__GG_VISUAL_DEBUG__?.connected === 1, undefined, { timeout: 30_000 });
      await page.waitForFunction(() => {
        const browser = globalThis as unknown as {
          document: {
            querySelector(selector: string): { dataset: { envState?: string } } | null;
          };
        };
        const state = browser.document.querySelector("#app")?.dataset.envState;
        return state === "applied" || state === "safety";
      }, undefined, { timeout: 30_000 });
      const envState = await page.locator("#app").getAttribute("data-env-state");
      if (envState !== "applied") {
        const diagnostic = await page.locator("#gg-render-diagnostic").textContent().catch(() => null);
        throw new Error(
          `${backend} environment did not apply; data-env-state=${envState ?? "missing"}; ` +
          `render-diagnostic=${diagnostic ?? "missing"}; console=${consoleDiagnostics.join(" | ") || "none"}`,
        );
      }
      await page.waitForTimeout(500);

      // Read the compositor-backed canvas screenshot. Reading the default
      // WebGL/WebGPU drawing buffer from a later task can legally return zeros
      // when preserveDrawingBuffer is false, even though the presented frame is
      // visible.
      const screenshot = await page.locator("#app > canvas").screenshot({ type: "png" });
      const screenshotUrl = `data:image/png;base64,${screenshot.toString("base64")}`;
      const pixels = await page.evaluate(async (imageUrl) => {
      interface BrowserImage {
        width: number;
        height: number;
        src: string;
        onload: (() => void) | null;
        onerror: (() => void) | null;
      }
      interface BrowserCanvas {
        width: number;
        height: number;
        getContext(
          kind: "2d",
          options: { willReadFrequently: boolean },
        ): {
          drawImage(source: BrowserImage, x: number, y: number, width: number, height: number): void;
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
          createElement(tag: "canvas"): BrowserCanvas;
        };
        Image: new () => BrowserImage;
      };
      const source = new browser.Image();
      await new Promise<void>((resolve, reject) => {
        source.onload = () => resolve();
        source.onerror = () => reject(new Error("canvas screenshot decode failed"));
        source.src = imageUrl;
      });
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
      }, screenshotUrl);
      if (pixels.darkRatio > 0.9) {
        const diagnostic = await page.locator("#gg-render-diagnostic").textContent().catch(() => null);
        throw new Error(
          `${backend} dark-frame regression: ` +
          `${(pixels.darkRatio * 100).toFixed(2)}% of spawn pixels are dark (>90%); ` +
          `data-env-state=${envState}; render-diagnostic=${diagnostic ?? "missing"}; ` +
          `console=${consoleDiagnostics.join(" | ") || "none"}`,
        );
      }
      if (errors.length > 0) throw new Error(`${backend} page errors: ${errors.join(" | ")}`);
      const lastClose = await page.locator("#app").getAttribute("data-last-close");
      if (lastClose !== "none") {
        throw new Error(`${backend} WebSocket closed during environment/frame probe: ${lastClose ?? "missing"}`);
      }
      // Feel instrumentation (F4). CI renders through a software rasteriser, so
      // the native-feel jitter budget (p99 <= 1.5x median) is NOT assertable
      // here — that belongs to the real-hardware matrix. What CI *can* protect
      // is that the meter itself stays wired: a silently-dead percentile ring
      // would otherwise make every future feel regression invisible.
      const feel = await page.evaluate(() => {
        const debug = (globalThis as unknown as {
          __GG_VISUAL_DEBUG__?: Record<string, number | string>;
        }).__GG_VISUAL_DEBUG__ ?? {};
        return {
          frameMedianMs: Number(debug.frameMedianMs ?? 0),
          frameP99Ms: Number(debug.frameP99Ms ?? 0),
        };
      });
      if (!(feel.frameMedianMs > 0) || !(feel.frameP99Ms > 0)) {
        throw new Error(
          `${backend} frame-time percentiles are not populated ` +
          `(median=${feel.frameMedianMs}, p99=${feel.frameP99Ms}) — the F4 meter is dead`,
        );
      }
      if (feel.frameP99Ms < feel.frameMedianMs) {
        throw new Error(`${backend} frame p99 (${feel.frameP99Ms}) below median (${feel.frameMedianMs})`);
      }
      console.log(JSON.stringify({
        test: `${backend}-greybox-spawn-not-dark-with-environment`,
        passed: true,
        envState,
        lastClose,
        ...pixels,
        ...feel,
      }));
      await page.close();
    }
    } finally {
      await browser.close();
    }
  }
} finally {
  stop(client);
  stop(server);
}
