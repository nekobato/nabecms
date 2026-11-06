import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createTemplateTokens,
  loadStarterVersion,
  scaffoldBasicStarter,
} from "../lib/create-project.mjs";

test("loadStarterVersion reads the published starter version", async () => {
  const starterPackage = JSON.parse(
    await fs.readFile(
      path.resolve(import.meta.dirname, "..", "package.json"),
      "utf8",
    ),
  );
  assert.equal(await loadStarterVersion(), starterPackage.version);
});

test("createTemplateTokens derives package-safe replacements", async () => {
  const version = await loadStarterVersion();
  const tokens = createTemplateTokens({
    projectName: "My Great CMS",
    packageName: "my-great-cms",
    version,
  });

  assert.equal(tokens.get("__PROJECT_NAME__"), "My Great CMS");
  assert.equal(tokens.get("__PACKAGE_NAME__"), "my-great-cms");
  assert.equal(tokens.get("__WORKER_NAME__"), "my-great-cms");
  assert.equal(tokens.get("__NABECMS_VERSION__"), version);
  assert.equal(tokens.get("__NABECMS_CLI_VERSION__"), version);
});

test("scaffoldBasicStarter creates a host app without installing", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "create-nabecms-"));
  const destinationDir = path.join(tempRoot, "my-cms");

  const result = await scaffoldBasicStarter({
    destinationDir,
    projectName: "my-cms",
    autoInstall: false,
  });

  assert.equal(result.packageName, "my-cms");
  const packageJson = JSON.parse(
    await fs.readFile(path.join(destinationDir, "package.json"), "utf8"),
  );
  const version = await loadStarterVersion();
  const wranglerConfig = await fs.readFile(
    path.join(destinationDir, "wrangler.jsonc"),
    "utf8",
  );

  assert.equal(packageJson.name, "my-cms");
  for (const filename of ["README.md", "README.ja.md"]) {
    const readme = await fs.readFile(
      path.join(destinationDir, filename),
      "utf8",
    );
    assert.ok(readme.startsWith("# my-cms\n"), filename);
    assert.ok(readme.includes(`NabeCMS \`${version}\``), filename);
  }
  assert.equal(packageJson.dependencies["@nekobato/nabecms"], version);
  assert.deepEqual(Object.keys(packageJson.dependencies), [
    "@nekobato/nabecms",
  ]);
  assert.match(
    wranglerConfig,
    /\.\/node_modules\/@nekobato\/nabecms\/admin\/dist/u,
  );
  assert.match(wranglerConfig, /"name": "my-cms"/u);
  assert.match(wranglerConfig, /"compatibility_flags": \["nodejs_compat"\]/u);
  assert.match(
    wranglerConfig,
    /"not_found_handling": "single-page-application"/u,
  );
  assert.match(wranglerConfig, /"run_worker_first": true/u);
  assert.ok(
    await fs
      .access(path.join(destinationDir, "src", "worker.ts"))
      .then(() => true),
  );
  assert.ok(
    await fs.access(path.join(destinationDir, ".gitignore")).then(() => true),
  );
  assert.equal(
    await fs
      .access(path.join(destinationDir, "_gitignore"))
      .then(() => true)
      .catch(() => false),
    false,
  );
});
