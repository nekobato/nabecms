import type { RuntimeMigration } from "./config";

/**
 * Minimal D1 prepared statement shape used by the runtime migration runner.
 */
type D1PreparedStatementLike = {
  all: <T = unknown>() => Promise<{ results?: T[] } | T[]>;
  run: <T = unknown>() => Promise<{ results?: T[] } | T[]>;
};

/**
 * Minimal D1 binding shape used by the runtime migration runner.
 */
type D1DatabaseLike = {
  batch?: (
    statements: D1PreparedStatementLike[],
  ) => Promise<readonly unknown[]>;
  prepare: (query: string) => D1PreparedStatementLike;
  exec: (query: string) => Promise<unknown>;
};

/**
 * Report returned after applying runtime migrations.
 */
export type RuntimeMigrationReport = {
  applied: string[];
  skipped: string[];
};

type RuntimeMigrationScope = "core" | "app";

type ScopedRuntimeMigration = RuntimeMigration & {
  scope: RuntimeMigrationScope;
};

const DEFAULT_MIGRATIONS_TABLE = "d1_migrations";

/**
 * Validate a SQL identifier before interpolating it into migration statements.
 */
const assertSqlIdentifier = (value: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`Invalid migration table identifier "${value}"`);
  }
  return value;
};

/**
 * Escape a string value for use inside a single-quoted SQL literal.
 */
const escapeSqlString = (value: string): string => value.replaceAll("'", "''");

/**
 * Normalize drizzle migration SQL before preparing it for D1.
 */
const normalizeMigrationSql = (sql: string): string =>
  sql
    .replace(/^\uFEFF/u, "")
    .replaceAll("--> statement-breakpoint", "\n")
    .trim();

/**
 * Split migration SQL into single prepared statements.
 *
 * D1Database::exec treats newlines as query separators, so multi-line DDL
 * should be executed through prepared statements instead.
 */
const splitMigrationStatements = (sql: string): string[] =>
  normalizeMigrationSql(sql)
    .split(/;\s*(?:\r?\n|$)/u)
    .map((statement) => statement.trim())
    .filter((statement) => {
      const withoutLineComments = statement
        .split(/\r?\n/u)
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim();
      return withoutLineComments.length > 0;
    });

/**
 * Normalize the result shape returned from `D1PreparedStatement::all()`.
 */
const extractResults = <T>(value: { results?: T[] } | T[]): T[] =>
  Array.isArray(value) ? value : (value.results ?? []);

/**
 * Attach scope information and reject duplicate migration names.
 */
const normalizeScopedMigrations = (
  scope: RuntimeMigrationScope,
  migrations: readonly RuntimeMigration[],
  seenNames: Set<string>,
): ScopedRuntimeMigration[] =>
  migrations.map((migration) => {
    if (seenNames.has(migration.name)) {
      throw new Error(`Duplicate runtime migration "${migration.name}"`);
    }
    seenNames.add(migration.name);
    return {
      ...migration,
      scope,
      sql: normalizeMigrationSql(migration.sql),
    };
  });

/**
 * Ensure the migration history table exists before reading or writing entries.
 */
const ensureMigrationsTable = async (
  db: D1DatabaseLike,
  tableName: string,
): Promise<void> => {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${tableName} (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`,
    )
    .run();
};

/**
 * Read already-applied migration names from the runtime history table.
 */
const listAppliedMigrationNames = async (
  db: D1DatabaseLike,
  tableName: string,
): Promise<Set<string>> => {
  const result = await db
    .prepare(`SELECT name FROM ${tableName} ORDER BY id ASC`)
    .all<{ name: string }>();

  return new Set(extractResults(result).map((entry) => entry.name));
};

/**
 * Atomically apply one migration and append its name to the history table.
 */
const applyMigration = async (
  db: D1DatabaseLike,
  tableName: string,
  migration: ScopedRuntimeMigration,
): Promise<void> => {
  const statements = splitMigrationStatements(migration.sql);
  if (statements.length === 0) {
    throw new Error(`Runtime migration "${migration.name}" has empty SQL`);
  }

  if (db.batch === undefined) {
    throw new Error(
      `D1 batch() is required to apply runtime migration "${migration.name}" atomically`,
    );
  }

  const preparedStatements = statements.map((statement) =>
    db.prepare(statement),
  );
  preparedStatements.push(
    db.prepare(
      `INSERT INTO ${tableName} (name) VALUES ('${escapeSqlString(
        migration.name,
      )}')`,
    ),
  );

  await db.batch(preparedStatements);
};

/**
 * Apply bundled runtime migrations against a D1 binding.
 */
export const runRuntimeMigrations = async ({
  db,
  tableName = DEFAULT_MIGRATIONS_TABLE,
  coreMigrations = [],
  appMigrations = [],
}: {
  db: D1DatabaseLike;
  tableName?: string;
  coreMigrations?: readonly RuntimeMigration[];
  appMigrations?: readonly RuntimeMigration[];
}): Promise<RuntimeMigrationReport> => {
  const validatedTableName = assertSqlIdentifier(tableName);
  const seenNames = new Set<string>();
  const migrations = [
    ...normalizeScopedMigrations("core", coreMigrations, seenNames),
    ...normalizeScopedMigrations("app", appMigrations, seenNames),
  ];

  if (migrations.length === 0) {
    return {
      applied: [],
      skipped: [],
    };
  }

  await ensureMigrationsTable(db, validatedTableName);
  const appliedNames = await listAppliedMigrationNames(db, validatedTableName);
  const report: RuntimeMigrationReport = {
    applied: [],
    skipped: [],
  };

  for (const migration of migrations) {
    if (appliedNames.has(migration.name)) {
      report.skipped.push(migration.name);
      continue;
    }

    await applyMigration(db, validatedTableName, migration);
    appliedNames.add(migration.name);
    report.applied.push(migration.name);
  }

  return report;
};
