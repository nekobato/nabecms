/// <reference types="@cloudflare/vitest-plugin/types" />

/**
 * Real D1 coverage for runtime migration rollback, resume, and idempotency.
 */
import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { runRuntimeMigrations } from "./migrations";

type MigrationDatabase = Parameters<typeof applyD1Migrations>[0];
type RuntimeMigrationDatabase = Parameters<
  typeof runRuntimeMigrations
>[0]["db"];

type MigrationTestEnv = {
  LEGACY_DB: MigrationDatabase;
};

const bindings = env as unknown as MigrationTestEnv;

/** Read a scalar count from a real D1 database. */
const readCount = async (
  db: MigrationDatabase,
  query: string,
): Promise<number> => (await db.prepare(query).first<number>("count")) ?? 0;

/** Return whether a SQLite table exists. */
const tableExists = async (
  db: MigrationDatabase,
  tableName: string,
): Promise<boolean> =>
  (await db
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(tableName)
    .first<number>("present")) === 1;

it("rolls back a failed runtime migration and resumes the same name after correction", async () => {
  const db = bindings.LEGACY_DB;
  const runtimeDb = db as unknown as RuntimeMigrationDatabase;
  const migrationName = "9000_runtime_atomic_probe.sql";

  await expect(
    runRuntimeMigrations({
      db: runtimeDb,
      tableName: "runtime_migrations",
      appMigrations: [
        {
          name: migrationName,
          sql: `CREATE TABLE runtime_atomic_probe (id INTEGER PRIMARY KEY);
INSERT INTO runtime_atomic_probe (id) VALUES (1);
INSERT INTO missing_runtime_dependency (id) VALUES (1);`,
        },
      ],
    }),
  ).rejects.toThrow();

  expect(await tableExists(db, "runtime_atomic_probe")).toBe(false);
  expect(
    await readCount(
      db,
      "SELECT COUNT(*) AS count FROM runtime_migrations WHERE name = '9000_runtime_atomic_probe.sql'",
    ),
  ).toBe(0);

  const resumed = await runRuntimeMigrations({
    db: runtimeDb,
    tableName: "runtime_migrations",
    appMigrations: [
      {
        name: migrationName,
        sql: `CREATE TABLE runtime_atomic_probe (id INTEGER PRIMARY KEY);
INSERT INTO runtime_atomic_probe (id) VALUES (1);`,
      },
    ],
  });
  expect(resumed).toEqual({ applied: [migrationName], skipped: [] });
  expect(await tableExists(db, "runtime_atomic_probe")).toBe(true);
  expect(
    await readCount(db, "SELECT COUNT(*) AS count FROM runtime_atomic_probe"),
  ).toBe(1);
  expect(
    await readCount(
      db,
      "SELECT COUNT(*) AS count FROM runtime_migrations WHERE name = '9000_runtime_atomic_probe.sql'",
    ),
  ).toBe(1);

  const repeated = await runRuntimeMigrations({
    db: runtimeDb,
    tableName: "runtime_migrations",
    appMigrations: [
      {
        name: migrationName,
        sql: "THIS INVALID SQL MUST BE SKIPPED;",
      },
    ],
  });
  expect(repeated).toEqual({ applied: [], skipped: [migrationName] });
  expect(
    await readCount(db, "SELECT COUNT(*) AS count FROM runtime_atomic_probe"),
  ).toBe(1);
});
