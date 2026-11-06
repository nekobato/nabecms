/**
 * Product browser smoke configuration for the reference NabeCMS Worker.
 * @module playwright-config
 */
import { fileURLToPath } from "node:url";
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

/** Return one stable environment value created by the E2E launcher. */
const requireE2eEnvironment = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Run this suite through pnpm admin:test:e2e; missing ${name}`);
  return value;
};

const workerOrigin = new URL(requireE2eEnvironment("NABECMS_E2E_BASE_URL")).origin;
const authStatePath = requireE2eEnvironment("NABECMS_E2E_AUTH_STATE");
const artifactRoot = fileURLToPath(new URL("../../output/playwright/", import.meta.url));
const browserChannel = process.env.NABECMS_E2E_BROWSER_CHANNEL?.trim();

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  retries: 0,
  workers: 1,
  outputDir: `${artifactRoot}/test-results`,
  reporter: [["line"], ["html", { open: "never", outputFolder: `${artifactRoot}/html` }]],
  use: {
    baseURL: `${workerOrigin}/admin/`,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(browserChannel ? { channel: browserChannel } : {}),
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts$/u,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "desktop-chromium",
      testMatch: /(?:non-goals|vue)\.spec\.ts$/u,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: authStatePath,
      },
    },
    {
      name: "mobile-chromium",
      testMatch: /mobile\.spec\.ts$/u,
      dependencies: ["desktop-chromium"],
      use: {
        ...devices["Pixel 5"],
        storageState: authStatePath,
      },
    },
  ],
  webServer: {
    command: "node ./e2e/start-reference-worker.mjs",
    cwd: fileURLToPath(new URL("./", import.meta.url)),
    url: `${workerOrigin}/api/contents/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    gracefulShutdown: { signal: "SIGTERM" as const, timeout: 10_000 },
    stdout: "pipe" as const,
    stderr: "pipe" as const,
  },
});
