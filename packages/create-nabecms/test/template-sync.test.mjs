import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const templateRoot = path.join(packageRoot, "template", "basic");
const exampleRoot = path.resolve(packageRoot, "..", "..", "examples", "basic");
const devRoot = path.resolve(packageRoot, "..", "dev");

const readJson = async (filePath) =>
  JSON.parse(await fs.readFile(filePath, "utf8"));

const parseRuntimeMigrationBundle = (source) => {
  const assignment = source.indexOf("appRuntimeMigrations");
  const arrayAssignment = source.indexOf("= [", assignment);
  const arrayStart = arrayAssignment + 2;
  const arrayEnd = source.lastIndexOf("];");
  assert.notEqual(assignment, -1, "runtime migration export");
  assert.notEqual(arrayAssignment, -1, "runtime migration array start");
  assert.notEqual(arrayEnd, -1, "runtime migration array end");
  return JSON.parse(source.slice(arrayStart, arrayEnd + 1));
};

const normalizeSnapshot = ({ id: _id, prevId: _prevId, ...snapshot }) =>
  snapshot;

const normalizeJournal = ({ entries, ...journal }) => ({
  ...journal,
  entries: entries.map(({ tag, when: _when, ...entry }) => ({
    ...entry,
    versionPrefix: tag.slice(0, 4),
  })),
});

test("template copies the reference app file set for runtime files", async () => {
  const runtimeFiles = [
    ".dev.vars.example",
    "drizzle.config.ts",
    "migrations/0000_wide_imperial_guard.sql",
    "migrations/0001_auth_foundation.sql",
    "migrations/0002_melodic_misty_knight.sql",
    "migrations/0003_early_avengers.sql",
    "migrations/0004_align_users_auth_columns.sql",
    "migrations/0005_cuddly_ogun.sql",
    "migrations/0006_windy_cardiac.sql",
    "migrations/0007_keen_leo.sql",
    "migrations/0008_futuristic_manta.sql",
    "migrations/0009_minimize_auth_logs.sql",
    "migrations/0010_log_retention.sql",
    "migrations/meta/0000_snapshot.json",
    "migrations/meta/0002_snapshot.json",
    "migrations/meta/0003_snapshot.json",
    "migrations/meta/0004_snapshot.json",
    "migrations/meta/0005_snapshot.json",
    "migrations/meta/0006_snapshot.json",
    "migrations/meta/0007_snapshot.json",
    "migrations/meta/0008_snapshot.json",
    "migrations/meta/0009_snapshot.json",
    "migrations/meta/0010_snapshot.json",
    "migrations/meta/_journal.json",
    "nabecms.config.ts",
    "src/database/runtime-migrations.generated.ts",
    "src/database/runtime-migrations.ts",
    "src/database/schema.ts",
    "src/worker.ts",
    "tsconfig.json",
  ];

  await Promise.all(
    runtimeFiles.map(async (relativePath) => {
      const [templateFile, exampleFile] = await Promise.all([
        fs.readFile(path.join(templateRoot, relativePath), "utf8"),
        fs.readFile(path.join(exampleRoot, relativePath), "utf8"),
      ]);
      assert.equal(templateFile, exampleFile, relativePath);
    }),
  );
});

test("dev, example, and template migration artifacts stay semantically synchronized", async () => {
  const [devSql, exampleSql, templateSql] = await Promise.all([
    fs.readFile(
      path.join(devRoot, "migrations/0007_living_loners.sql"),
      "utf8",
    ),
    fs.readFile(path.join(exampleRoot, "migrations/0007_keen_leo.sql"), "utf8"),
    fs.readFile(
      path.join(templateRoot, "migrations/0007_keen_leo.sql"),
      "utf8",
    ),
  ]);
  assert.equal(devSql, exampleSql, "0007 SQL: dev/example");
  assert.equal(exampleSql, templateSql, "0007 SQL: example/template");

  const [devIdempotencySql, exampleIdempotencySql, templateIdempotencySql] =
    await Promise.all([
      fs.readFile(
        path.join(devRoot, "migrations/0008_tan_silver_fox.sql"),
        "utf8",
      ),
      fs.readFile(
        path.join(exampleRoot, "migrations/0008_futuristic_manta.sql"),
        "utf8",
      ),
      fs.readFile(
        path.join(templateRoot, "migrations/0008_futuristic_manta.sql"),
        "utf8",
      ),
    ]);
  assert.equal(
    devIdempotencySql,
    exampleIdempotencySql,
    "0008 SQL: dev/example",
  );
  assert.equal(
    exampleIdempotencySql,
    templateIdempotencySql,
    "0008 SQL: example/template",
  );

  const [devSnapshot, exampleSnapshot, templateSnapshot] = await Promise.all([
    readJson(path.join(devRoot, "migrations/meta/0007_snapshot.json")),
    readJson(path.join(exampleRoot, "migrations/meta/0007_snapshot.json")),
    readJson(path.join(templateRoot, "migrations/meta/0007_snapshot.json")),
  ]);
  assert.deepEqual(
    normalizeSnapshot(devSnapshot),
    normalizeSnapshot(exampleSnapshot),
    "0007 snapshot: dev/example",
  );
  assert.deepEqual(
    exampleSnapshot,
    templateSnapshot,
    "0007 snapshot: example/template",
  );

  const [
    devIdempotencySnapshot,
    exampleIdempotencySnapshot,
    templateIdempotencySnapshot,
  ] = await Promise.all([
    readJson(path.join(devRoot, "migrations/meta/0008_snapshot.json")),
    readJson(path.join(exampleRoot, "migrations/meta/0008_snapshot.json")),
    readJson(path.join(templateRoot, "migrations/meta/0008_snapshot.json")),
  ]);
  assert.deepEqual(
    normalizeSnapshot(devIdempotencySnapshot),
    normalizeSnapshot(exampleIdempotencySnapshot),
    "0008 snapshot: dev/example",
  );
  assert.deepEqual(
    exampleIdempotencySnapshot,
    templateIdempotencySnapshot,
    "0008 snapshot: example/template",
  );

  const roots = [devRoot, exampleRoot, templateRoot];
  const minimizedSql = await Promise.all(
    roots.map((root) =>
      fs.readFile(
        path.join(root, "migrations/0009_minimize_auth_logs.sql"),
        "utf8",
      ),
    ),
  );
  assert.equal(minimizedSql[0], minimizedSql[1], "0009 SQL: dev/example");
  assert.equal(minimizedSql[1], minimizedSql[2], "0009 SQL: example/template");
  const minimizedSnapshots = await Promise.all(
    roots.map(async (root) =>
      normalizeSnapshot(
        await readJson(path.join(root, "migrations/meta/0009_snapshot.json")),
      ),
    ),
  );
  assert.deepEqual(
    minimizedSnapshots[0],
    minimizedSnapshots[1],
    "0009 snapshot: dev/example",
  );
  assert.deepEqual(
    minimizedSnapshots[1],
    minimizedSnapshots[2],
    "0009 snapshot: example/template",
  );

  const [devJournal, exampleJournal, templateJournal] = await Promise.all([
    readJson(path.join(devRoot, "migrations/meta/_journal.json")),
    readJson(path.join(exampleRoot, "migrations/meta/_journal.json")),
    readJson(path.join(templateRoot, "migrations/meta/_journal.json")),
  ]);
  assert.deepEqual(
    normalizeJournal(devJournal),
    normalizeJournal(exampleJournal),
    "journal: dev/example",
  );
  assert.deepEqual(
    exampleJournal,
    templateJournal,
    "journal: example/template",
  );

  const rootsAndJournals = [
    [devRoot, devJournal],
    [exampleRoot, exampleJournal],
    [templateRoot, templateJournal],
  ];
  for (const [root, journal] of rootsAndJournals) {
    assert.equal(journal.entries.length, 11, `${root}: migration count`);
    await Promise.all(
      journal.entries.map(({ tag }) =>
        fs.readFile(path.join(root, "migrations", `${tag}.sql`), "utf8"),
      ),
    );
  }

  const [devBundle, exampleBundle, templateBundle] = await Promise.all(
    [devRoot, exampleRoot, templateRoot].map(async (root) =>
      parseRuntimeMigrationBundle(
        await fs.readFile(
          path.join(root, "src/database/runtime-migrations.generated.ts"),
          "utf8",
        ),
      ),
    ),
  );
  const normalizeBundle = (bundle) =>
    bundle.map(({ name, sql }) => ({ name: name.slice(0, 4), sql }));
  assert.deepEqual(
    normalizeBundle(devBundle),
    normalizeBundle(exampleBundle),
    "runtime bundle: dev/example",
  );
  assert.deepEqual(
    exampleBundle,
    templateBundle,
    "runtime bundle: example/template",
  );

  for (const [root, journal, bundle] of [
    [devRoot, devJournal, devBundle],
    [exampleRoot, exampleJournal, exampleBundle],
    [templateRoot, templateJournal, templateBundle],
  ]) {
    assert.deepEqual(
      bundle.map(({ name }) => name),
      journal.entries.map(({ tag }) => `${tag}.sql`),
      `${root}: journal/runtime names`,
    );
    await Promise.all(
      bundle.map(async ({ name, sql }) => {
        const source = await fs.readFile(
          path.join(root, "migrations", name),
          "utf8",
        );
        assert.equal(sql, source, `${root}: ${name} runtime SQL`);
      }),
    );
  }
});

test("template package.json keeps the same public script contract as examples/basic", async () => {
  const [templatePackageJson, examplePackageJson] = await Promise.all([
    readJson(path.join(templateRoot, "package.json")),
    readJson(path.join(exampleRoot, "package.json")),
  ]);

  assert.deepEqual(templatePackageJson.scripts, examplePackageJson.scripts);
});

test("template and reference app typecheck with explicit compiler dependencies", async () => {
  const [templatePackageJson, examplePackageJson] = await Promise.all([
    readJson(path.join(templateRoot, "package.json")),
    readJson(path.join(exampleRoot, "package.json")),
  ]);

  assert.equal(
    examplePackageJson.scripts.typecheck,
    "wrangler types && tsc -p tsconfig.json --noEmit",
  );
  for (const dependency of ["typescript", "@types/node", "wrangler"]) {
    assert.equal(
      templatePackageJson.devDependencies[dependency],
      examplePackageJson.devDependencies[dependency],
    );
  }
});

test("template pins the standalone pnpm 11 workspace policy", async () => {
  const [
    rootPackageJson,
    templatePackageJson,
    rootWorkspaceConfig,
    templateWorkspaceConfig,
  ] = await Promise.all([
    readJson(path.resolve(packageRoot, "..", "..", "package.json")),
    readJson(path.join(templateRoot, "package.json")),
    fs.readFile(
      path.resolve(packageRoot, "..", "..", "pnpm-workspace.yaml"),
      "utf8",
    ),
    fs.readFile(path.join(templateRoot, "pnpm-workspace.yaml"), "utf8"),
  ]);

  assert.equal(
    templatePackageJson.packageManager,
    rootPackageJson.packageManager,
  );
  assert.deepEqual(templatePackageJson.engines, rootPackageJson.engines);
  assert.match(templateWorkspaceConfig, /^ignoreWorkspaceRootCheck: true$/mu);
  assert.match(templateWorkspaceConfig, /^blockExoticSubdeps: true$/mu);
  assert.match(templateWorkspaceConfig, /^strictDepBuilds: true$/mu);
  for (const packageName of ["esbuild", "sharp", "workerd"]) {
    assert.match(
      templateWorkspaceConfig,
      new RegExp(`^  ${packageName}: true$`, "mu"),
    );
  }
  assert.match(templateWorkspaceConfig, /^  "@parcel\/watcher": true$/mu);

  for (const [selector, version] of [
    ["brace-expansion@>=2.0.0 <2.1.7", "2.1.7"],
    ["immutable@<5.1.8", "5.1.9"],
    ["linkify-it@<5.0.2", "5.0.2"],
    ["sharp@<0.35.5", "0.35.5"],
    ["shell-quote@>=1.8.4 <1.11.0", "1.11.0"],
    ["undici@>=7.0.0 <7.30.1", "7.30.1"],
  ]) {
    const overridePattern = new RegExp(
      `^  "${selector.replaceAll(".", "\\.")}": ${version.replaceAll(".", "\\.")}$`,
      "mu",
    );
    assert.match(rootWorkspaceConfig, overridePattern);
    assert.match(templateWorkspaceConfig, overridePattern);
  }
});

test("starter schedules log cleanup daily in default and production environments", async () => {
  for (const root of [templateRoot, exampleRoot]) {
    const source = await fs.readFile(path.join(root, "wrangler.jsonc"), "utf8");
    assert.equal(
      (source.match(/"crons": \["0 18 \* \* \*"\]/gu) ?? []).length,
      2,
    );
    const worker = await fs.readFile(path.join(root, "src/worker.ts"), "utf8");
    assert.match(worker, /fetch: app\.fetch/u);
    assert.match(worker, /async scheduled\(/u);
    assert.match(worker, /await runLogCleanup\(env\)/u);
  }
});
