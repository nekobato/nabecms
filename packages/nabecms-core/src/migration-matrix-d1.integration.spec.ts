/// <reference types="@cloudflare/vitest-plugin/types" />

/**
 * Real D1 coverage for applying the complete repository migration chain fresh.
 */
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { expect, it } from "vitest";

type MigrationDatabase = Parameters<typeof applyD1Migrations>[0];

type MigrationTestEnv = {
  CURRENT_SCHEMA_SNAPSHOT: DrizzleSnapshot;
  LEGACY_DB: MigrationDatabase;
  SOURCE_SCHEMA_DB: MigrationDatabase;
  SOURCE_SCHEMA_SQL: string;
  TEST_MIGRATIONS: D1Migration[];
};

type TableColumn = {
  dflt_value: string | null;
  name: string;
  notnull: number;
  pk: number;
  type: string;
};

type IndexRow = {
  name: string;
  origin: string;
  unique: number;
};

type DrizzleSnapshotColumn = {
  default?: unknown;
  name: string;
  notNull: boolean;
  primaryKey: boolean;
  type: string;
};

type DrizzleSnapshotIndex = {
  columns: string[];
  isUnique: boolean;
  name: string;
};

type DrizzleSnapshotForeignKey = {
  columnsFrom: string[];
  columnsTo: string[];
  onDelete?: string;
  onUpdate?: string;
  tableTo: string;
};

type DrizzleSnapshotTable = {
  checkConstraints: Record<string, never>;
  columns: Record<string, DrizzleSnapshotColumn>;
  foreignKeys: Record<string, DrizzleSnapshotForeignKey>;
  indexes: Record<string, DrizzleSnapshotIndex>;
  name: string;
  uniqueConstraints: Record<string, never>;
};

type DrizzleSnapshot = {
  tables: Record<string, DrizzleSnapshotTable>;
};

type ForeignKeyRow = {
  from: string;
  id: number;
  on_delete: string;
  on_update: string;
  seq: number;
  table: string;
  to: string;
};

type IndexColumnRow = {
  name: string | null;
  seqno: number;
};

type NormalizedColumn = {
  default: string | null;
  name: string;
  notNull: boolean;
  primaryKey: boolean;
  type: string;
};

type NormalizedForeignKey = {
  columnsFrom: string[];
  columnsTo: string[];
  onDelete: string;
  onUpdate: string;
  tableTo: string;
};

type NormalizedIndex = {
  columns: string[];
  isUnique: boolean;
  name: string;
};

type NormalizedTable = {
  columns: NormalizedColumn[];
  foreignKeys: NormalizedForeignKey[];
  indexes: NormalizedIndex[];
  name: string;
};

const bindings = env as unknown as MigrationTestEnv;

/** Normalize equivalent SQLite default-expression spellings. */
const normalizeDefault = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  let normalized = String(value).trim();
  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replaceAll(/\s+/gu, " ");
};

/** Return a deterministic sort key for a normalized schema item. */
const schemaItemKey = (value: unknown): string => JSON.stringify(value);

/** Sort normalized schema items without mutating their source arrays. */
const sortSchemaItems = <T>(values: readonly T[]): T[] =>
  [...values].sort((left, right) =>
    schemaItemKey(left).localeCompare(schemaItemKey(right)),
  );

/** Narrow D1 result rows at the database boundary. */
const readResultRows = <T>(result: { results: unknown[] }): T[] =>
  result.results as T[];

/** Normalize the checked-in Drizzle snapshot for an exact D1 comparison. */
const normalizeSnapshot = (snapshot: DrizzleSnapshot): NormalizedTable[] =>
  Object.values(snapshot.tables)
    .map((table) => {
      if (
        Object.keys(table.uniqueConstraints).length > 0 ||
        Object.keys(table.checkConstraints).length > 0
      ) {
        throw new Error(
          `Schema comparison does not support table constraints: ${table.name}`,
        );
      }

      return {
        name: table.name,
        columns: sortSchemaItems(
          Object.values(table.columns).map((column) => ({
            name: column.name,
            type: column.type.toLowerCase(),
            notNull: column.notNull,
            primaryKey: column.primaryKey,
            default: normalizeDefault(column.default),
          })),
        ),
        indexes: sortSchemaItems(
          Object.values(table.indexes).map((index) => ({
            name: index.name,
            columns: index.columns.map((column) =>
              column.replace(/["`]/gu, ""),
            ),
            isUnique: index.isUnique,
          })),
        ),
        foreignKeys: sortSchemaItems(
          Object.values(table.foreignKeys).map((foreignKey) => ({
            tableTo: foreignKey.tableTo,
            columnsFrom: foreignKey.columnsFrom,
            columnsTo: foreignKey.columnsTo,
            onDelete: (foreignKey.onDelete ?? "no action").toLowerCase(),
            onUpdate: (foreignKey.onUpdate ?? "no action").toLowerCase(),
          })),
        ),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

/** Read expression-index terms as well as ordinary PRAGMA column names. */
const splitIndexColumns = (ddl: string): string[] => {
  const terms = ddl.slice(ddl.indexOf("(") + 1, ddl.lastIndexOf(")"));
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  let quote = "";
  for (let i = 0; i < terms.length; i++) {
    const ch = terms[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "`" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      result.push(terms.slice(start, i));
      start = i + 1;
    }
  }
  result.push(terms.slice(start));
  return result.map((term) => term.trim().replace(/["`]/gu, ""));
};

/** Read and normalize every table, column, index, and foreign key from D1. */
const readNormalizedD1Schema = async (
  db: MigrationDatabase,
): Promise<NormalizedTable[]> => {
  const tableResult = await db
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT GLOB '_cf_*'
         AND name <> 'd1_migrations'
       ORDER BY name`,
    )
    .all<{ name: string }>();
  const tableNames = tableResult.results.map(
    ({ name }: { name: string }) => name,
  );

  const tables: NormalizedTable[] = [];
  for (const tableName of tableNames) {
    const columnResult = await db
      .prepare(
        "SELECT name, type, [notnull], dflt_value, pk FROM pragma_table_info(?)",
      )
      .bind(tableName)
      .all<TableColumn>();
    const indexResult = await db
      .prepare("SELECT name, [unique], origin FROM pragma_index_list(?)")
      .bind(tableName)
      .all<IndexRow>();
    const foreignKeyResult = await db
      .prepare(
        `SELECT id, seq, [table], [from], [to], on_update, on_delete
         FROM pragma_foreign_key_list(?)`,
      )
      .bind(tableName)
      .all<ForeignKeyRow>();

    const columnRows = readResultRows<TableColumn>(columnResult);
    const explicitIndexes = readResultRows<IndexRow>(indexResult).filter(
      ({ origin }) => origin === "c",
    );
    const indexes: NormalizedIndex[] = [];
    for (const index of explicitIndexes) {
      const columns = await db
        .prepare("SELECT seqno, name FROM pragma_index_info(?)")
        .bind(index.name)
        .all<IndexColumnRow>();
      const ddl = await db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .bind(index.name)
        .first<string>("sql");
      const expressions = splitIndexColumns(ddl ?? "");
      indexes.push({
        name: index.name,
        columns: readResultRows<IndexColumnRow>(columns)
          .toSorted((left, right) => left.seqno - right.seqno)
          .map(({ name, seqno }) => name ?? expressions[seqno]),
        isUnique: index.unique === 1,
      });
    }

    const groupedForeignKeys = Map.groupBy(
      readResultRows<ForeignKeyRow>(foreignKeyResult),
      ({ id }) => id,
    );
    const foreignKeys = [...groupedForeignKeys.values()].map(
      (rows): NormalizedForeignKey => {
        const orderedRows = rows.toSorted(
          (left, right) => left.seq - right.seq,
        );
        const first = orderedRows[0];
        if (!first) {
          throw new Error(`Empty foreign-key group on ${tableName}`);
        }
        return {
          tableTo: first.table,
          columnsFrom: orderedRows.map(({ from }) => from),
          columnsTo: orderedRows.map(({ to }) => to),
          onDelete: first.on_delete.toLowerCase(),
          onUpdate: first.on_update.toLowerCase(),
        };
      },
    );

    tables.push({
      name: tableName,
      columns: sortSchemaItems(
        columnRows.map((column) => ({
          name: column.name,
          type: column.type.toLowerCase(),
          notNull: column.notnull === 1,
          primaryKey: column.pk === 1,
          default: normalizeDefault(column.dflt_value),
        })),
      ),
      indexes: sortSchemaItems(indexes),
      foreignKeys: sortSchemaItems(foreignKeys),
    });
  }
  return tables;
};

/** Read SQLite table columns from a real D1 database. */
const readTableColumns = async (
  db: MigrationDatabase,
  tableName: string,
): Promise<TableColumn[]> =>
  (await db.prepare(`PRAGMA table_info('${tableName}')`).all<TableColumn>())
    .results;

/** Read SQLite index metadata from a real D1 database. */
const readIndexes = async (
  db: MigrationDatabase,
  tableName: string,
): Promise<IndexRow[]> =>
  (await db.prepare(`PRAGMA index_list('${tableName}')`).all<IndexRow>())
    .results;

/** Assert that SQLite reports no broken foreign-key references. */
const expectForeignKeysValid = async (db: MigrationDatabase): Promise<void> => {
  const result = await db.prepare("PRAGMA foreign_key_check").all();
  expect(result.results).toEqual([]);
};

/**
 * Split Drizzle's exported DDL into D1 batch statements.
 *
 * `D1Database.exec()` treats each physical line as a complete statement, while
 * Drizzle emits multiline `CREATE TABLE` statements. The current export format
 * uses semicolons only as statement terminators; reject an embedded semicolon
 * instead of risking a partial schema when that format changes.
 */
const splitExportedSchemaSql = (sql: string): string[] => {
  const unexpectedSemicolonLine = sql.split(/\r?\n/gu).find((line) => {
    const semicolons = [...line.matchAll(/;/gu)];
    return (
      semicolons.length > 1 ||
      (semicolons.length === 1 && !line.trimEnd().endsWith(";"))
    );
  });
  if (unexpectedSemicolonLine !== undefined) {
    throw new Error(
      `Unsupported embedded semicolon in drizzle-kit export: ${unexpectedSemicolonLine}`,
    );
  }

  const statements = sql
    .split(/;\s*/gu)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  if (statements.length === 0) {
    throw new Error("drizzle-kit export did not contain executable statements");
  }
  return statements;
};

/** Execute the complete exported source schema atomically in an empty D1. */
const applyExportedSourceSchema = async (
  db: MigrationDatabase,
  sql: string,
): Promise<void> => {
  const statements = splitExportedSchemaSql(sql).map((statement) =>
    db.prepare(statement),
  );
  await db.batch(statements);
};

it("matches the source schema after applying 0000 through 0010 fresh and skips a reapply", async () => {
  const db = bindings.LEGACY_DB;

  await applyD1Migrations(db, bindings.TEST_MIGRATIONS);

  const firstHistory = await db
    .prepare("SELECT name FROM d1_migrations ORDER BY id")
    .all<{ name: string }>();
  expect(
    firstHistory.results.map(({ name }: { name: string }) => name),
  ).toEqual(bindings.TEST_MIGRATIONS.map(({ name }) => name));
  expect(firstHistory.results).toHaveLength(11);

  const sessionColumns = await readTableColumns(db, "auth_sessions");
  expect(sessionColumns.map(({ name }) => name)).toEqual([
    "id",
    "user_id",
    "token",
    "legacy_refresh_token_hash",
    "expires_at",
    "ip_address",
    "user_agent",
    "created_at",
    "updated_at",
  ]);
  expect(sessionColumns).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "id", pk: 1, type: "TEXT" }),
      expect.objectContaining({ name: "user_id", notnull: 1, type: "TEXT" }),
      expect.objectContaining({ name: "token", notnull: 1, type: "TEXT" }),
      expect.objectContaining({
        name: "expires_at",
        notnull: 1,
        type: "INTEGER",
      }),
      expect.objectContaining({ name: "ip_address", type: "TEXT" }),
      expect.objectContaining({ name: "user_agent", type: "TEXT" }),
      expect.objectContaining({ name: "created_at", type: "INTEGER" }),
      expect.objectContaining({ name: "updated_at", type: "INTEGER" }),
    ]),
  );

  const accountColumns = await readTableColumns(db, "auth_accounts");
  expect(accountColumns.map(({ name }) => name)).toEqual([
    "id",
    "user_id",
    "provider_id",
    "account_id",
    "password_hash",
    "access_token",
    "refresh_token",
    "id_token",
    "scope",
    "access_token_expires_at",
    "refresh_token_expires_at",
    "created_at",
    "updated_at",
  ]);
  expect(accountColumns).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "id", pk: 1, type: "TEXT" }),
      expect.objectContaining({ name: "user_id", notnull: 1, type: "TEXT" }),
      expect.objectContaining({
        name: "provider_id",
        notnull: 1,
        type: "TEXT",
      }),
      expect.objectContaining({ name: "account_id", notnull: 1, type: "TEXT" }),
      expect.objectContaining({ name: "password_hash", type: "TEXT" }),
      expect.objectContaining({
        name: "access_token_expires_at",
        type: "INTEGER",
      }),
      expect.objectContaining({
        name: "refresh_token_expires_at",
        type: "INTEGER",
      }),
      expect.objectContaining({
        name: "created_at",
        notnull: 1,
        type: "INTEGER",
      }),
      expect.objectContaining({ name: "updated_at", type: "INTEGER" }),
    ]),
  );

  const verificationColumns = await readTableColumns(db, "auth_verifications");
  expect(verificationColumns.map(({ name }) => name)).toEqual([
    "id",
    "identifier",
    "value",
    "expires_at",
    "created_at",
    "updated_at",
  ]);
  expect(verificationColumns).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "id", pk: 1, type: "TEXT" }),
      expect.objectContaining({
        name: "expires_at",
        notnull: 1,
        type: "INTEGER",
      }),
      expect.objectContaining({
        name: "updated_at",
        notnull: 1,
        type: "INTEGER",
      }),
    ]),
  );

  const userColumns = await readTableColumns(db, "users");
  expect(userColumns.map(({ name }) => name).toSorted()).toEqual(
    [
      "created_at",
      "email",
      "email_verified",
      "id",
      "image",
      "name",
      "password",
      "role_id",
      "ui_preferences",
      "updated_at",
    ].toSorted(),
  );
  expect(userColumns.find(({ name }) => name === "name")?.dflt_value).toBe(
    "''",
  );
  expect(userColumns.find(({ name }) => name === "role_id")?.dflt_value).toBe(
    "'[]'",
  );

  expect(await readIndexes(db, "auth_sessions")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "auth_sessions_token_unique",
        unique: 1,
      }),
      expect.objectContaining({
        name: "auth_sessions_legacy_refresh_token_hash_unique",
        unique: 1,
      }),
      expect.objectContaining({ name: "auth_sessions_user_idx" }),
    ]),
  );
  expect(await readIndexes(db, "auth_accounts")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "auth_accounts_provider_account_unique",
        unique: 1,
      }),
      expect.objectContaining({ name: "auth_accounts_user_idx" }),
    ]),
  );
  expect(await readIndexes(db, "auth_verifications")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "auth_verifications_identifier_idx",
      }),
    ]),
  );
  expect(await readNormalizedD1Schema(db)).toEqual(
    normalizeSnapshot(bindings.CURRENT_SCHEMA_SNAPSHOT),
  );
  await applyExportedSourceSchema(
    bindings.SOURCE_SCHEMA_DB,
    bindings.SOURCE_SCHEMA_SQL,
  );
  expect(await readNormalizedD1Schema(bindings.SOURCE_SCHEMA_DB)).toEqual(
    await readNormalizedD1Schema(db),
  );
  await expectForeignKeysValid(db);

  await applyD1Migrations(db, bindings.TEST_MIGRATIONS);

  const secondHistory = await db
    .prepare("SELECT name FROM d1_migrations ORDER BY id")
    .all<{ name: string }>();
  expect(secondHistory.results).toEqual(firstHistory.results);
  await expectForeignKeysValid(db);
});
