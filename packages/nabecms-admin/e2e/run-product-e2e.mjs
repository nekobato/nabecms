/**
 * Launch the product browser smoke with one isolated local Worker state.
 * Secrets and persistence paths are created once here so Playwright's repeated
 * configuration evaluation cannot produce divergent values.
 * @module e2e/run-product-e2e
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const temporaryParent = path.join(repositoryRoot, ".tmp");
const temporaryPrefix = path.join(temporaryParent, "nabecms-e2e-");
const workerOrigin = "http://localhost:8787";
const processCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

let activeChild;
let temporaryRoot;
let shuttingDown = false;

/** Generate high-entropy URL-safe material for local test credentials. */
const createSecret = () => randomBytes(32).toString("base64url");

/** Wait until a child exits and return its normalized exit code. */
const waitForExit = (child) =>
  new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });

/** Wait for a bounded duration without blocking signal handlers. */
const waitForMilliseconds = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/** Send a signal to a spawned process group without touching unrelated jobs. */
const signalProcessTree = (child, signal) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
};

/** Stop the active Playwright process tree with a bounded graceful period. */
const terminateActiveChild = async (signal = "SIGTERM") => {
  const child = activeChild;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  signalProcessTree(child, signal);
  await Promise.race([waitForExit(child).catch(() => 1), waitForMilliseconds(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    signalProcessTree(child, "SIGKILL");
    await Promise.race([waitForExit(child).catch(() => 1), waitForMilliseconds(2_000)]);
  }
};

/** Remove only the launcher-owned temporary directory. */
const cleanupTemporaryRoot = async () => {
  if (!temporaryRoot) return;
  const resolvedRoot = path.resolve(temporaryRoot);
  const resolvedPrefix = path.resolve(temporaryPrefix);
  if (!resolvedRoot.startsWith(resolvedPrefix)) {
    throw new Error(`Refusing to remove unexpected E2E path: ${resolvedRoot}`);
  }
  await rm(resolvedRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
};

/** Handle terminal signals, stop children, and clean the isolated state. */
const shutdownFromSignal = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await terminateActiveChild(signal);
    await cleanupTemporaryRoot();
  } finally {
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
};

process.once("SIGINT", () => void shutdownFromSignal("SIGINT"));
process.once("SIGTERM", () => void shutdownFromSignal("SIGTERM"));

/** Create the isolated environment and execute Playwright. */
const main = async () => {
  await mkdir(temporaryParent, { recursive: true });
  temporaryRoot = await mkdtemp(temporaryPrefix);

  const stateDirectory = path.join(temporaryRoot, "worker-state");
  const environmentFile = path.join(temporaryRoot, ".dev.vars.e2e");
  const authStateFile = path.join(temporaryRoot, "admin-storage-state.json");
  const bootstrapSecret = createSecret();
  const adminPassword = `E2e-${createSecret()}-Aa1!`;

  await mkdir(stateDirectory, { recursive: true });
  await writeFile(
    environmentFile,
    [`BOOTSTRAP_SECRET=${bootstrapSecret}`, `JWT_SECRET=${createSecret()}`, `BETTER_AUTH_SECRET=${createSecret()}`, "BCRYPT_COST=4", ""].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );

  activeChild = spawn(processCommand, ["-C", "packages/nabecms-admin", "exec", "playwright", "test"], {
    cwd: repositoryRoot,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      NABECMS_E2E_STATE_DIR: stateDirectory,
      NABECMS_E2E_ENV_FILE: environmentFile,
      NABECMS_E2E_BOOTSTRAP_SECRET: bootstrapSecret,
      NABECMS_E2E_ADMIN_EMAIL: "release-admin@example.com",
      NABECMS_E2E_ADMIN_PASSWORD: adminPassword,
      NABECMS_E2E_BASE_URL: workerOrigin,
      NABECMS_E2E_AUTH_STATE: authStateFile,
    },
    stdio: "inherit",
  });

  const exitCode = await waitForExit(activeChild);
  activeChild = undefined;
  process.exitCode = exitCode;
};

try {
  await main();
} catch (error) {
  console.error("Failed to run product browser smoke", error);
  process.exitCode = 1;
} finally {
  if (!shuttingDown) {
    await terminateActiveChild();
    await cleanupTemporaryRoot();
  }
}
