import { spawn } from "node:child_process";
import process from "node:process";
import { generateRuntimeMigrationsBundle } from "./bundle-migrations.mjs";

/**
 * Parse CLI flags for the public migration command.
 */
export const parseMigrateOptions = (argv) => {
  const args = [...argv];
  let binding = "DB";
  let environment;
  let preview = false;
  let persistTo;
  let remote = false;
  let local = false;

  while (args.length > 0) {
    const current = args.shift();

    if (current === "--remote") {
      remote = true;
      continue;
    }

    if (current === "--local") {
      local = true;
      continue;
    }

    if (current === "--preview") {
      preview = true;
      continue;
    }

    if (current === "--binding") {
      binding = args.shift() ?? binding;
      continue;
    }

    if (current === "--env") {
      environment = args.shift();
      continue;
    }

    if (current === "--persist-to") {
      persistTo = args.shift();
      continue;
    }

    throw new Error(`Unknown option: ${current}`);
  }

  if (remote && local) {
    throw new Error("Use either --local or --remote, not both");
  }

  return {
    binding,
    environment,
    preview,
    persistTo,
    mode: remote ? "remote" : "local",
  };
};

/**
 * Format CLI usage for the migrate command.
 */
export const formatMigrateHelp =
  () => `Usage: nabecms migrate [--local|--remote] [--env <name>] [--binding <binding>] [--preview] [--persist-to <dir>]

Options:
  --local        Apply migrations to the local D1 state (default)
  --remote       Apply migrations to the remote D1 database
  --env <name>   Wrangler environment name passed through to the command
  --binding <x>  D1 binding name or database name (default: DB)
  --preview      Target the preview D1 database
  --persist-to   Local persistence directory forwarded to wrangler
`;

/**
 * Spawn wrangler with inherited stdio and return its exit code.
 */
export const spawnWranglerCommand = (args, { cwd = process.cwd() } = {}) =>
  new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(command, ["exec", "wrangler", ...args], {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });

/**
 * Run the migrate command against the current host app.
 */
export const runMigrateCommand = async ({
  argv = [],
  projectRoot = process.cwd(),
  spawnWrangler = spawnWranglerCommand,
} = {}) => {
  const options = parseMigrateOptions(argv);

  await generateRuntimeMigrationsBundle({ projectRoot });

  const wranglerArgs = ["d1", "migrations", "apply", options.binding];
  wranglerArgs.push(options.mode === "remote" ? "--remote" : "--local");

  if (options.environment) {
    wranglerArgs.push("--env", options.environment);
  }

  if (options.preview) {
    wranglerArgs.push("--preview");
  }

  if (options.persistTo) {
    wranglerArgs.push("--persist-to", options.persistTo);
  }

  return Number(await spawnWrangler(wranglerArgs, { cwd: projectRoot }));
};
