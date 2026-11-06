import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const templateRoot = path.join(packageRoot, "template", "basic");
const packageManifestPath = path.join(packageRoot, "package.json");

/**
 * Replace unsafe package-name characters with kebab-case separators.
 */
const toPackageName = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "") || "nabecms-app";

/**
 * Decide whether a directory already contains files.
 */
const hasFiles = async (directoryPath) => {
  const entries = await readdir(directoryPath);
  return entries.length > 0;
};

/**
 * Load the lockstep NabeCMS version from this published starter.
 */
export const loadStarterVersion = async () => {
  const manifest = JSON.parse(await readFile(packageManifestPath, "utf8"));
  return manifest.version;
};

/**
 * Build token replacements for one generated app.
 */
export const createTemplateTokens = ({ projectName, packageName, version }) =>
  new Map([
    ["__PROJECT_NAME__", projectName],
    ["__PACKAGE_NAME__", packageName],
    ["__WORKER_NAME__", packageName],
    ["__NABECMS_VERSION__", version],
    ["__NABECMS_CLI_VERSION__", version],
  ]);

/**
 * Apply token replacement to one text file.
 */
const replaceTokensInFile = async (filePath, tokens) => {
  const source = await readFile(filePath, "utf8");
  const updated = [...tokens.entries()].reduce(
    (current, [token, replacement]) => current.replaceAll(token, replacement),
    source,
  );
  await writeFile(filePath, updated, "utf8");
};

/**
 * Fill template placeholders after the file tree has been copied.
 */
const hydrateTemplate = async ({ destinationDir, tokens }) => {
  await Promise.all(
    ["package.json", "wrangler.jsonc", "README.md", "README.ja.md"].map(
      (relativePath) =>
        replaceTokensInFile(path.join(destinationDir, relativePath), tokens),
    ),
  );
};

/**
 * Restore dotfiles that are stored under npm-packable template names.
 */
const restoreTemplateDotfiles = async ({ destinationDir }) => {
  await rename(
    path.join(destinationDir, "_gitignore"),
    path.join(destinationDir, ".gitignore"),
  );
};

/**
 * Install dependencies in the generated app.
 */
export const runPnpmInstall = async ({
  destinationDir,
  stdout = console.log,
  stderr = console.error,
}) =>
  new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(command, ["install"], {
      cwd: destinationDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    child.stdout.on("data", (chunk) => {
      stdout(String(chunk).trimEnd());
    });
    child.stderr.on("data", (chunk) => {
      stderr(String(chunk).trimEnd());
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });

/**
 * Scaffold one NabeCMS host app from the built-in basic template.
 */
export const scaffoldBasicStarter = async ({
  destinationDir,
  projectName,
  autoInstall = true,
  stdout = console.log,
  stderr = console.error,
}) => {
  const absoluteDestination = path.resolve(destinationDir);
  const version = await loadStarterVersion();
  const packageName = toPackageName(projectName);

  await mkdir(absoluteDestination, { recursive: true });
  if (await hasFiles(absoluteDestination)) {
    throw new Error(`Target directory "${absoluteDestination}" is not empty`);
  }

  await cp(templateRoot, absoluteDestination, {
    recursive: true,
  });

  await restoreTemplateDotfiles({
    destinationDir: absoluteDestination,
  });

  await hydrateTemplate({
    destinationDir: absoluteDestination,
    tokens: createTemplateTokens({
      projectName,
      packageName,
      version,
    }),
  });

  if (!autoInstall) {
    return {
      destinationDir: absoluteDestination,
      packageName,
    };
  }

  stdout("Installing dependencies with pnpm...");
  const exitCode = await runPnpmInstall({
    destinationDir: absoluteDestination,
    stdout,
    stderr,
  });

  if (exitCode !== 0) {
    throw new Error(
      `pnpm install failed with exit code ${exitCode}. Retry inside "${absoluteDestination}" with "pnpm install".`,
    );
  }

  return {
    destinationDir: absoluteDestination,
    packageName,
  };
};

/**
 * Format help for the create-nabecms command.
 */
export const formatCreateHelp =
  () => `Usage: npm create nabecms@next [directory]
       npm create nabecms@<version> [directory]
       pnpm create nabecms@next [directory]

Scaffolds a minimal NabeCMS host app, then runs "pnpm install".
Use @next for the latest Alpha, or @<version> to select a release.`;

/**
 * Run the create-nabecms entrypoint.
 */
export const runCreateNabeCms = async ({
  argv = [],
  cwd = process.cwd(),
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  const targetArg = argv[0] ?? ".";
  const destinationDir = path.resolve(cwd, targetArg);
  const projectName =
    targetArg === "." ? path.basename(cwd) : path.basename(destinationDir);
  const autoInstall = process.env.NABECMS_CREATE_SKIP_INSTALL !== "1";

  try {
    const result = await scaffoldBasicStarter({
      destinationDir,
      projectName,
      autoInstall,
      stdout,
      stderr,
    });

    stdout("");
    stdout("NabeCMS app created.");
    if (path.resolve(cwd) !== result.destinationDir) {
      stdout(`  cd ${path.relative(cwd, result.destinationDir) || "."}`);
    }
    stdout("  cp .dev.vars.example .dev.vars");
    stdout("  pnpm nabecms:migrate --local");
    stdout("  pnpm dev");
    return 0;
  } catch (error) {
    stderr(
      error instanceof Error ? error.message : "Failed to create NabeCMS app",
    );
    return 1;
  }
};
