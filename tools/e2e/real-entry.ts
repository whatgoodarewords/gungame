// The REAL entry path, end to end: load → click the canvas → pointer lock
// engages → W key → the player moves. No synthetic input hook — this is the
// exact flow a human takes, and the exact flow every "I'm stuck, can't play"
// report lives in. Requires a headed browser (pointer lock is not granted in
// headless): run under xvfb-run on CI.

import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const OUT = process.env.GG_E2E_OUT ?? "e2e-artifacts";
mkdirSync(OUT, { recursive: true });

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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastError)}`);
}

const server = start(["pnpm", "--filter", "@gungame/server", "dev"], {
  ALLOW_HEADLESS_BOTS: "1",
  BUILD_HASH: "dev",
  PORT: "8787",
});
const client = start(
  ["pnpm", "--filter", "@gungame/client", "dev", "--host", "127.0.0.1", "--port", "5173"],
);

try {
  await Promise.all([
    waitFor("http://127.0.0.1:8787/gg/healthz"),
    waitFor("http://127.0.0.1:5173/gg/"),
  ]);
  const { chromium } = await import("playwright");
  // HEADED — pointer lock needs a real windowing surface (xvfb on CI).
  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await (await browser.newContext({
    viewport: { width: 1280, height: 720 },
  })).newPage();
  const consoleLines: string[] = [];
  page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${String(e)}`));

  try {
    await page.goto(
      "http://127.0.0.1:5173/gg/?name=RealEntry&create=1&mode=gungame&map=foundry&backend=webgl2",
      { waitUntil: "domcontentloaded", timeout: 90_000 },
    );
    await page.waitForFunction(
      () => (globalThis as unknown as {
        __GG_VISUAL_DEBUG__?: { connected?: number };
      }).__GG_VISUAL_DEBUG__?.connected === 1,
      undefined,
      { timeout: 45_000 },
    );
    await page.waitForTimeout(2_000);

    // THE HUMAN FLOW: click the game world.
    await page.mouse.click(640, 360);
    // Lock must engage (data-lock-state=locked) within 3 s of the click.
    await page.waitForFunction(() => {
      const doc = (globalThis as unknown as {
        document: { querySelector(s: string): { getAttribute(n: string): string | null } | null };
      }).document;
      return doc.querySelector("#app")?.getAttribute("data-lock-state") === "locked";
    }, undefined, { timeout: 3_000 });

    const readPos = () => page.evaluate(() => {
      const d = (globalThis as unknown as {
        __GG_VISUAL_DEBUG__?: Record<string, number>;
      }).__GG_VISUAL_DEBUG__ ?? {};
      return { x: Number(d.playerX ?? 0), z: Number(d.playerZ ?? 0) };
    });
    const before = await readPos();
    // REAL KEYBOARD: hold W for 3 s.
    await page.keyboard.down("w");
    await page.waitForTimeout(3_000);
    await page.keyboard.up("w");
    const after = await readPos();
    const displacement = Math.hypot(after.x - before.x, after.z - before.z);
    await page.screenshot({ path: `${OUT}/real-entry-after-move.png` });

    const verdict = {
      lockEngaged: true,
      displacement: Number(displacement.toFixed(2)),
      pass: displacement > 2.5,
    };
    writeFileSync(`${OUT}/real-entry-verdict.json`, JSON.stringify(verdict, null, 2));
    console.log(JSON.stringify(verdict));
    if (!verdict.pass) {
      throw new Error(`REAL ENTRY FAILED: locked but displacement ${displacement.toFixed(2)}m`);
    }
    console.log("REAL ENTRY PASSED: click → lock → W → movement");
  } finally {
    writeFileSync(`${OUT}/real-entry-console.log`, consoleLines.join("\n"));
    await browser.close();
  }
} finally {
  stop(client);
  stop(server);
}
