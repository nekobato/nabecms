/**
 * Build and run the reference Worker used by the product browser smoke.
 * @module e2e/start-reference-worker
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const processCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const artifactDirectory = path.join(repositoryRoot, "output/playwright");
const logPath = path.join(artifactDirectory, "reference-worker.log");

let activeChild;
let logStream;
let shuttingDown = false;

/** Return a required launcher-provided environment variable. */
const requireEnvironment = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required E2E environment variable: ${name}`);
  return value;
};

/** Wait until a child exits and return its normalized exit code. */
const waitForExit = (child) =>
  new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });

/** Write command output to both the terminal and the browser artifact log. */
const forwardOutput = (source, destination) => {
  source?.on("data", (chunk) => {
    destination.write(chunk);
    logStream?.write(chunk);
  });
};

/** Spawn one managed command whose output is retained for CI diagnosis. */
const spawnManagedCommand = (args) => {
  const child = spawn(processCommand, args, {
    cwd: repositoryRoot,
    detached: process.platform !== "win32",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  forwardOutput(child.stdout, process.stdout);
  forwardOutput(child.stderr, process.stderr);
  activeChild = child;
  return child;
};

/** Run one finite setup command and reject non-zero exits. */
const runSetupCommand = async (label, args) => {
  const child = spawnManagedCommand(args);
  const exitCode = await waitForExit(child);
  activeChild = undefined;
  if (exitCode !== 0) throw new Error(`${label} failed with exit code ${exitCode}`);
};

/** Signal only the currently managed process group. */
const terminateActiveChild = async (signal = "SIGTERM") => {
  const child = activeChild;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") console.error("Failed to stop E2E child", error);
      }
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
};

/** Stop the Worker before Playwright terminates the web-server wrapper. */
const shutdownFromSignal = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  await terminateActiveChild(signal);
  logStream?.end();
  process.exit(signal === "SIGINT" ? 130 : 143);
};

process.once("SIGINT", () => void shutdownFromSignal("SIGINT"));
process.once("SIGTERM", () => void shutdownFromSignal("SIGTERM"));

/** Build assets, migrate isolated D1, and keep Wrangler running. */
const main = async () => {
  const stateDirectory = requireEnvironment("NABECMS_E2E_STATE_DIR");
  const environmentFile = requireEnvironment("NABECMS_E2E_ENV_FILE");

  await mkdir(artifactDirectory, { recursive: true });
  logStream = createWriteStream(logPath, { flags: "w", mode: 0o600 });

  await runSetupCommand("Admin build and asset sync", ["run", "build"]);
  await runSetupCommand("Reference D1 migration", ["-C", "examples/basic", "run", "nabecms:migrate", "--local", "--persist-to", stateDirectory]);

  const worker = spawnManagedCommand([
    "-C",
    "examples/basic",
    "exec",
    "wrangler",
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    "8787",
    "--persist-to",
    stateDirectory,
    "--env-file",
    environmentFile,
    "--log-level",
    "warn",
  ]);
  const exitCode = await waitForExit(worker);
  activeChild = undefined;
  if (!shuttingDown && exitCode !== 0) {
    throw new Error(`Reference Worker exited with code ${exitCode}`);
  }
};

try {
  await main();
} catch (error) {
  console.error("Failed to start reference Worker", error);
  process.exitCode = 1;
} finally {
  if (!shuttingDown) await terminateActiveChild();
  logStream?.end();
}
