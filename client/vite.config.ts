import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: "/gg/",
    define: {
      __BUILD_HASH__: JSON.stringify(env.BUILD_HASH ?? "dev"),
    },
  };
});
