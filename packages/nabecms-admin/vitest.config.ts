import { fileURLToPath } from "node:url";
import { mergeConfig, defineConfig, configDefaults } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      exclude: [...configDefaults.exclude, "e2e/**"],
      // Vue component suites become CPU-starved at Vitest's host-sized default.
      maxWorkers: 2,
      root: fileURLToPath(new URL("./", import.meta.url)),
    },
  }),
);
