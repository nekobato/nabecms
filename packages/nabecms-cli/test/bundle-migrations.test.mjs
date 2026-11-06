import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  generateRuntimeMigrationsBundle,
  loadRuntimeMigrations,
} from "../lib/bundle-migrations.mjs";

test("loadRuntimeMigrations reads the drizzle journal order", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nabecms-cli-migrations-"),
  );

  await fs.mkdir(path.join(tempRoot, "migrations", "meta"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(tempRoot, "migrations", "meta", "_journal.json"),
    JSON.stringify({
      entries: [
        { idx: 2, tag: "0002_second" },
        { idx: 1, tag: "0001_first" },
      ],
    }),
  );
  await fs.writeFile(
    path.join(tempRoot, "migrations", "0001_first.sql"),
    "SELECT 1;",
  );
  await fs.writeFile(
    path.join(tempRoot, "migrations", "0002_second.sql"),
    "SELECT 2;",
  );

  const migrations = await loadRuntimeMigrations({ projectRoot: tempRoot });

  assert.deepEqual(migrations, [
    { name: "0001_first.sql", sql: "SELECT 1;" },
    { name: "0002_second.sql", sql: "SELECT 2;" },
  ]);
});

test("generateRuntimeMigrationsBundle writes the runtime bundle", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nabecms-cli-bundle-"),
  );

  await fs.mkdir(path.join(tempRoot, "migrations", "meta"), {
    recursive: true,
  });
  await fs.mkdir(path.join(tempRoot, "src", "database"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(tempRoot, "migrations", "meta", "_journal.json"),
    JSON.stringify({
      entries: [{ idx: 0, tag: "0000_init" }],
    }),
  );
  await fs.writeFile(
    path.join(tempRoot, "migrations", "0000_init.sql"),
    "CREATE TABLE demo(id integer);",
  );

  const outputPath = await generateRuntimeMigrationsBundle({
    projectRoot: tempRoot,
  });
  const generated = await fs.readFile(outputPath, "utf8");

  assert.match(generated, /appRuntimeMigrations/u);
  assert.match(generated, /from "@nekobato\/nabecms"/u);
  assert.doesNotMatch(generated, /@nekobato\/nabecms-core/u);
  assert.match(generated, /0000_init\.sql/u);
  assert.match(generated, /CREATE TABLE demo/u);
});
