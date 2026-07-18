import { build } from "esbuild";

await build({
  bundle: true,
  entryPoints: ["src/index.ts"],
  external: ["uWebSockets.js"],
  format: "esm",
  logLevel: "info",
  outdir: "dist",
  platform: "node",
  sourcemap: true,
  target: "node22",
});
