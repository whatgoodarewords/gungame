import { build } from "esbuild";

const buildHash = process.env.BUILD_HASH ?? "dev";

await build({
  bundle: true,
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash),
  },
  entryPoints: ["src/index.ts"],
  external: ["uWebSockets.js"],
  format: "esm",
  logLevel: "info",
  outdir: "dist",
  platform: "node",
  sourcemap: true,
  target: "node22",
});
