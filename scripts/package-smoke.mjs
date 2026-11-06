import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const artifactsDirectory = path.join(repoRoot, "output", "packages");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const packageTargets = [
  {
    directory: "packages/nabecms-core",
    name: "@nekobato/nabecms-core",
    requiredFiles: ["package/package.json", "package/src/index.ts"],
  },
  {
    directory: "packages/nabecms-admin",
    name: "@nekobato/nabecms-admin",
    requiredFiles: [
      "package/package.json",
      "package/dist/index.html",
      "package/dist/THIRD_PARTY_NOTICES.txt",
    ],
  },
  {
    directory: "packages/nabecms",
    name: "@nekobato/nabecms",
    requiredFiles: [
      "package/package.json",
      "package/src/index.ts",
      "package/admin/dist/index.html",
      "package/admin/dist/THIRD_PARTY_NOTICES.txt",
    ],
  },
  {
    directory: "packages/nabecms-cli",
    name: "@nekobato/nabecms-cli",
    requiredFiles: ["package/package.json", "package/bin/nabecms.mjs"],
  },
  {
    directory: "packages/create-nabecms",
    name: "create-nabecms",
    requiredFiles: ["package/package.json", "package/bin/create-nabecms.mjs"],
  },
];

const run = async (command, args, options = {}) => {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = await execFileAsync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout ?? 180_000,
  });
  if (options.printOutput !== false) {
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
  }
  return result.stdout;
};

const readJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

const writeJson = async (filePath, value) =>
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

/** Reject a partial version bump before any release artifacts are published. */
const validatePackageVersions = (artifacts) => {
  const version = artifacts[0].manifest.version;
  const names = new Set(artifacts.map((artifact) => artifact.name));
  for (const { name, manifest } of artifacts) {
    if (manifest.version !== version) {
      throw new Error(
        `${name} has version ${manifest.version}; expected ${version}.`,
      );
    }
    for (const [dependency, range] of Object.entries(
      manifest.dependencies ?? {},
    )) {
      if (names.has(dependency) && range !== version) {
        throw new Error(
          `${name} must depend on ${dependency}@${version}, got ${range}.`,
        );
      }
    }
  }
};

/** Reserve an available loopback port without sharing an existing dev server. */
const availablePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

/** Exercise the installed tarballs against a migrated, isolated local Worker. */
const smokeLocalApp = async (directory, port, secrets) => {
  const origin = `http://127.0.0.1:${port}`;
  const inspectorPort = await availablePort();
  const child = spawn(
    pnpmCommand,
    [
      "run",
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
    ],
    {
      cwd: directory,
      detached: process.platform !== "win32",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let failure;
  let interrupted = false;
  const capture = (chunk) => {
    output = (output + chunk).slice(-16_000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.once("error", (error) => {
    failure = error;
  });
  const exited = new Promise((resolve) => child.once("close", resolve));
  const signalChild = (signal) => {
    try {
      if (process.platform !== "win32" && child.pid)
        process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const interrupt = () => {
    interrupted = true;
    process.exitCode = 1;
    signalChild("SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  console.log(
    `Packed app smoke: ${origin} (PID ${child.pid}, state ${directory}/.wrangler)`,
  );
  const request = (pathname, options = {}) =>
    fetch(`${origin}${pathname}`, {
      ...options,
      signal: AbortSignal.timeout(10_000),
    });
  const json = async (pathname, options, status = 200) => {
    const response = await request(pathname, options);
    if (response.status !== status)
      throw new Error(
        `${pathname} returned ${response.status}; expected ${status}.`,
      );
    return { response, body: await response.json() };
  };
  try {
    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (interrupted || child.exitCode !== null || child.signalCode !== null)
        throw new Error("Packed app stopped before startup completed.");
      try {
        const response = await fetch(`${origin}/admin/`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok && (await response.text()).includes("<html")) {
          ready = true;
          break;
        }
      } catch {
        /* Wrangler may still be starting. */
      }
      await delay(250);
    }
    if (!ready) throw new Error("Packed app startup exceeded 120 seconds.");
    const bootstrapPath = "/api/admin/system/bootstrap";
    const before = await json(bootstrapPath);
    if (before.body.initialized !== false)
      throw new Error("Packed app must start with an empty D1 database.");
    const email = "package-smoke@example.test";
    await json(
      "/api/admin/auth/initialize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "X-Nabecms-Bootstrap-Secret": secrets.bootstrap,
        },
        body: JSON.stringify({
          email,
          password: secrets.password,
          name: "Package smoke",
          defaultLocale: "en",
        }),
      },
      201,
    );
    const after = await json(bootstrapPath);
    if (after.body.initialized !== true)
      throw new Error("Packed app initialization was not persisted.");
    const login = await json("/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email, password: secrets.password }),
    });
    let accessToken = login.body.accessToken;
    if (login.body.betterAuth === true) {
      const cookie = login.response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      if (!cookie)
        throw new Error("Packed app login did not set a session cookie.");
      const session = await json("/api/admin/auth/session-token", {
        method: "POST",
        headers: { Cookie: cookie, Origin: origin },
      });
      accessToken = session.body.accessToken;
    }
    if (typeof accessToken !== "string" || !accessToken)
      throw new Error("Packed app did not issue an Admin API access token.");
    const me = await json("/api/admin/auth/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (me.body.user?.email !== email)
      throw new Error(
        "Packed app did not authenticate its initial administrator.",
      );
    console.log(
      "Packed app local migration, Admin assets, initialization, and login passed.",
    );
  } catch (error) {
    for (const value of Object.values(secrets))
      output = output.replaceAll(value, "[REDACTED]");
    if (output.trim()) console.error(output);
    throw error;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    signalChild("SIGTERM");
    await Promise.race([exited, delay(5_000, undefined, { ref: false })]);
    signalChild("SIGKILL");
  }
};

const packPackage = async (target) => {
  const output = await run(
    pnpmCommand,
    ["pack", "--json", "--pack-destination", artifactsDirectory],
    {
      cwd: path.join(repoRoot, target.directory),
      printOutput: false,
    },
  );
  const report = JSON.parse(output);
  const filename = Array.isArray(report)
    ? report[0]?.filename
    : report.filename;
  if (!filename) {
    throw new Error(`${target.name} did not report a packed tarball.`);
  }

  const tarballPath = path.isAbsolute(filename)
    ? filename
    : path.join(artifactsDirectory, filename);
  const manifestSource = await run(
    "tar",
    ["-xOf", tarballPath, "package/package.json"],
    { printOutput: false },
  );
  const manifest = JSON.parse(manifestSource);
  if (JSON.stringify(manifest).includes("workspace:")) {
    throw new Error(`${target.name} contains a workspace dependency.`);
  }

  const members = new Set(
    (
      await run("tar", ["-tf", tarballPath], {
        printOutput: false,
      })
    )
      .split("\n")
      .filter(Boolean),
  );
  for (const requiredFile of [
    ...target.requiredFiles,
    "package/README.md",
    "package/README.ja.md",
    "package/LICENSE",
  ]) {
    if (!members.has(requiredFile)) {
      throw new Error(`${target.name} is missing ${requiredFile}.`);
    }
  }

  return { ...target, manifest, tarballPath };
};

const smokePackedPackages = async (artifacts) => {
  const smokeRoot = await mkdtemp(
    path.join(os.tmpdir(), "nabecms-package-smoke-"),
  );
  try {
    const byName = new Map(
      artifacts.map((artifact) => [artifact.name, artifact]),
    );
    const starter = byName.get("create-nabecms");
    const facade = byName.get("@nekobato/nabecms");
    const core = byName.get("@nekobato/nabecms-core");
    const cli = byName.get("@nekobato/nabecms-cli");
    if (!starter || !facade || !core || !cli) {
      throw new Error("Package smoke is missing a required tarball.");
    }

    const runnerDirectory = path.join(smokeRoot, "runner");
    const consumerDirectory = path.join(smokeRoot, "consumer");
    await mkdir(runnerDirectory, { recursive: true });
    await writeJson(path.join(runnerDirectory, "package.json"), {
      private: true,
      dependencies: {
        "create-nabecms": `file:${starter.tarballPath}`,
      },
    });
    await run(pnpmCommand, ["install", "--ignore-workspace"], {
      cwd: runnerDirectory,
    });
    await run(pnpmCommand, ["exec", "create-nabecms", consumerDirectory], {
      cwd: runnerDirectory,
      env: { ...process.env, NABECMS_CREATE_SKIP_INSTALL: "1" },
    });

    const consumerManifestPath = path.join(consumerDirectory, "package.json");
    const consumerManifest = await readJson(consumerManifestPath);
    for (const [group, name] of [
      ["dependencies", "@nekobato/nabecms"],
      ["devDependencies", "@nekobato/nabecms-cli"],
    ]) {
      if (consumerManifest[group]?.[name] !== starter.manifest.version) {
        throw new Error(
          `Generated app must pin ${name} to the starter version.`,
        );
      }
    }
    consumerManifest.dependencies["@nekobato/nabecms"] =
      `file:${facade.tarballPath}`;
    consumerManifest.devDependencies["@nekobato/nabecms-cli"] =
      `file:${cli.tarballPath}`;
    await writeJson(consumerManifestPath, consumerManifest);
    const workspaceConfigPath = path.join(
      consumerDirectory,
      "pnpm-workspace.yaml",
    );
    const workspaceConfig = await readFile(workspaceConfigPath, "utf8");
    const overridesMarker = "\noverrides:\n";
    if (!workspaceConfig.includes(overridesMarker)) {
      throw new Error("Generated app is missing pnpm workspace overrides.");
    }
    await writeFile(
      workspaceConfigPath,
      workspaceConfig.replace(
        overridesMarker,
        `${overridesMarker}  "@nekobato/nabecms-core": ${JSON.stringify(`file:${core.tarballPath}`)}\n`,
      ),
      "utf8",
    );
    const port = await availablePort();
    const secret = () => randomBytes(32).toString("base64url");
    const secrets = {
      bootstrap: secret(),
      jwt: secret(),
      auth: secret(),
      password: `Smoke-${secret()}-Aa1!`,
    };
    await writeFile(
      path.join(consumerDirectory, ".dev.vars"),
      [
        `BOOTSTRAP_SECRET=${secrets.bootstrap}`,
        `JWT_SECRET=${secrets.jwt}`,
        `BETTER_AUTH_SECRET=${secrets.auth}`,
        `BETTER_AUTH_URL=http://127.0.0.1:${port}`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o600 },
    );

    await run(pnpmCommand, ["install"], { cwd: consumerDirectory });
    await run(pnpmCommand, ["run", "typecheck"], { cwd: consumerDirectory });
    await run(pnpmCommand, ["run", "nabecms:doctor"], {
      cwd: consumerDirectory,
    });
    await run(pnpmCommand, ["run", "nabecms:migrate", "--local"], {
      cwd: consumerDirectory,
    });
    await run(
      pnpmCommand,
      [
        "exec",
        "wrangler",
        "deploy",
        "--dry-run",
        "--env=",
        "--outdir",
        path.join(smokeRoot, "dry-run"),
      ],
      { cwd: consumerDirectory },
    );
    await access(
      path.join(
        consumerDirectory,
        "node_modules",
        "@nekobato",
        "nabecms",
        "admin",
        "dist",
        "index.html",
      ),
    );
    await smokeLocalApp(consumerDirectory, port, secrets);
  } finally {
    await rm(smokeRoot, { recursive: true, force: true });
  }
};

await rm(artifactsDirectory, { recursive: true, force: true });
await mkdir(artifactsDirectory, { recursive: true });

const artifacts = [];
for (const target of packageTargets) {
  artifacts.push(await packPackage(target));
}

validatePackageVersions(artifacts);
await smokePackedPackages(artifacts);
console.log(`Package smoke passed for ${artifacts.length} tarballs.`);
