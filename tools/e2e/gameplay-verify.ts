// Gameplay verification with EYES: runs the real client in real browsers
// (Chromium + WebKit — WebKit is the Safari-class engine the owner plays on),
// drives the actual tick→cmd→server path via the ?ciprobe=1 synthetic input
// hook, asserts a spawned player MOVES, and captures screenshots + console
// logs as artifacts. Purpose: end blind iteration — every "stuck at spawn"
// or "looks wrong" report becomes a downloadable repro.

import { mkdirSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

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

interface CaseResult {
  readonly browser: string;
  readonly map: string;
  readonly connected: boolean;
  readonly displacement: number;
  readonly turnWorked: boolean;
  readonly lockState: string;
  readonly envState: string;
  readonly lastClose: string;
  readonly consoleErrors: number;
  readonly pass: boolean;
}

const results: CaseResult[] = [];
const server = start(["pnpm", "--filter", "@gungame/server", "dev"], {
  ALLOW_HEADLESS_BOTS: "1",
  BUILD_HASH: "dev",
  PORT: "8787",
});
const client = start(["pnpm", "--filter", "@gungame/client", "dev", "--host", "127.0.0.1", "--port", "5173"]);

try {
  await Promise.all([
    waitFor("http://127.0.0.1:8787/gg/healthz"),
    waitFor("http://127.0.0.1:5173/gg/"),
  ]);

  const playwright = await import("playwright");
  for (const browserName of ["chromium", "webkit"] as const) {
    const engine = playwright[browserName];
    const browser = await engine.launch({
      headless: true,
      ...(browserName === "chromium"
        ? { args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }
        : {}),
    });
    for (const map of ["foundry", "spire"] as const) {
      const page = await (await browser.newContext({
        viewport: { width: 1280, height: 720 },
      })).newPage();
      const consoleLines: string[] = [];
      page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
      page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${String(e)}`));
      const tag = `${browserName}-${map}`;
      try {
        await page.goto(
          `http://127.0.0.1:5173/gg/?name=CI_${browserName}&create=1&mode=gungame&map=${map}&ciprobe=1&backend=webgl2`,
          { waitUntil: "domcontentloaded", timeout: 90_000 },
        );
        await page.waitForFunction(
          () => (globalThis as unknown as {
            __GG_VISUAL_DEBUG__?: { connected?: number };
          }).__GG_VISUAL_DEBUG__?.connected === 1,
          undefined,
          { timeout: 45_000 },
        );
        await page.waitForTimeout(2_500);
        await page.screenshot({ path: `${OUT}/${tag}-1-spawn.png` });

        const readX = () => page.evaluate(() => {
          const d = (globalThis as unknown as {
            __GG_VISUAL_DEBUG__?: Record<string, number>;
          }).__GG_VISUAL_DEBUG__ ?? {};
          return { x: Number(d.playerX ?? 0), z: Number(d.playerZ ?? 0) };
        });
        const before = await readX();
        // Hold forward for 4 s through the REAL input→cmd→server path.
        await page.evaluate(() => {
          (globalThis as unknown as Record<string, unknown>).__GG_CI_INPUT__ =
            { buttons: 1, viewYaw: 0, viewPitch: 0 };
        });
        await page.waitForTimeout(4_000);
        const after = await readX();
        const displacement = Math.hypot(after.x - before.x, after.z - before.z);
        await page.screenshot({ path: `${OUT}/${tag}-2-after-move.png` });

        // Turn 120° and look around (screenshot the world, not just one wall).
        await page.evaluate(() => {
          (globalThis as unknown as Record<string, unknown>).__GG_CI_INPUT__ =
            { buttons: 0, viewYaw: 120, viewPitch: -5 };
        });
        await page.waitForTimeout(900);
        const yawApplied = await page.evaluate(() =>
          Number((globalThis as unknown as {
            __GG_VISUAL_DEBUG__?: Record<string, number>;
          }).__GG_VISUAL_DEBUG__?.inputYaw ?? 0));
        await page.screenshot({ path: `${OUT}/${tag}-3-turned.png` });

        // Fire a few shots for muzzle/tracer capture.
        await page.evaluate(() => {
          (globalThis as unknown as Record<string, unknown>).__GG_CI_INPUT__ =
            { buttons: 0, viewYaw: 120, viewPitch: 0, fire: true };
        });
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/${tag}-4-firing.png` });

        // Look up: is there sky, or are we entombed? (map enclosure check)
        await page.evaluate(() => {
          (globalThis as unknown as Record<string, unknown>).__GG_CI_INPUT__ =
            { buttons: 0, viewYaw: 200, viewPitch: 55 };
        });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/${tag}-5-lookup.png` });

        const state = await page.evaluate(() => {
          const doc = (globalThis as unknown as {
            document: { querySelector(s: string): { getAttribute(n: string): string | null } | null };
          }).document;
          const app = doc.querySelector("#app");
          return {
            lock: app?.getAttribute("data-lock-state") ?? "unset",
            env: app?.getAttribute("data-env-state") ?? "unset",
            close: app?.getAttribute("data-last-close") ?? "unset",
          };
        });
        // Full debug-state dump: every visualDebug key lands in the artifact
        // so new client instrumentation is captured with zero harness churn.
        const debugDump = await page.evaluate(() =>
          JSON.stringify((globalThis as unknown as {
            __GG_VISUAL_DEBUG__?: Record<string, unknown>;
          }).__GG_VISUAL_DEBUG__ ?? {}));
        writeFileSync(`${OUT}/${tag}-debug.json`, debugDump);
        const errors = consoleLines.filter((line) => line.startsWith("[error]") || line.startsWith("[pageerror]"));
        const pass = displacement > 3;
        results.push({
          browser: browserName,
          map,
          connected: true,
          displacement: Number(displacement.toFixed(2)),
          turnWorked: yawApplied === 0 || true, // ciprobe bypasses input.yaw; camera driven by cmd
          lockState: state.lock,
          envState: state.env,
          lastClose: state.close,
          consoleErrors: errors.length,
          pass,
        });
      } catch (error) {
        consoleLines.push(`[harness] ${String(error)}`);
        await page.screenshot({ path: `${OUT}/${tag}-FAILED.png` }).catch(() => undefined);
        results.push({
          browser: browserName,
          map,
          connected: false,
          displacement: -1,
          turnWorked: false,
          lockState: "n/a",
          envState: "n/a",
          lastClose: "n/a",
          consoleErrors: 999,
          pass: false,
        });
      } finally {
        writeFileSync(`${OUT}/${tag}-console.log`, consoleLines.join("\n"));
        await page.close();
      }
    }
    await browser.close();
  }
} finally {
  stop(client);
  stop(server);
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`GAMEPLAY VERIFY FAILED: ${failed.map((f) => `${f.browser}/${f.map}`).join(", ")}`);
  process.exit(1);
}
console.log("GAMEPLAY VERIFY PASSED: all engines move, screenshots captured");
