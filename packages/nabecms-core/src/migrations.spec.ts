import { describe, expect, it, vi } from "vitest";
import { createApp } from "./create-app";
import { runRuntimeMigrations } from "./migrations";

type StubD1Result<T> = {
  results: T[];
};

type RuntimeMigrationDatabase = Parameters<
  typeof runRuntimeMigrations
>[0]["db"];

type StubD1Database = RuntimeMigrationDatabase & {
  appliedNames: Set<string>;
  batchQueries: string[][];
  executedQueries: string[];
};

type StubD1DatabaseOptions = {
  failBatchOnQuery?: string;
  initialAppliedNames?: string[];
};

/**
 * Create a small D1 stub tailored for runtime migration tests.
 */
const createStubD1Database = ({
  failBatchOnQuery,
  initialAppliedNames = [],
}: StubD1DatabaseOptions = {}): StubD1Database => {
  const appliedNames = new Set(initialAppliedNames);
  const batchQueries: string[][] = [];
  const executedQueries: string[] = [];
  const preparedQueries = new WeakMap<object, string>();

  const runStatement = async (query: string) => {
    executedQueries.push(query);

    const matches = query.matchAll(
      /INSERT INTO d1_migrations \(name\) VALUES \('((?:[^']|'')*)'\)/gu,
    );

    for (const match of matches) {
      appliedNames.add(match[1]!.replaceAll("''", "'"));
    }

    return { count: 1, duration: 0 };
  };

  const prepare: RuntimeMigrationDatabase["prepare"] = (query) => {
    const preparedStatement = {
      all: async <T = unknown>(): Promise<StubD1Result<T>> => ({
        results: (query === "SELECT name FROM d1_migrations ORDER BY id ASC"
          ? [...appliedNames].map((name) => ({ name }))
          : []) as T[],
      }),
      run: async <T = unknown>(): Promise<StubD1Result<T>> => {
        await runStatement(query);
        return { results: [] };
      },
    };
    preparedQueries.set(preparedStatement, query);
    return preparedStatement;
  };

  const batch: NonNullable<RuntimeMigrationDatabase["batch"]> = async (
    statements,
  ) => {
    const queries = statements.map((statement) => {
      const query = preparedQueries.get(statement);
      if (query === undefined) {
        throw new Error("Unexpected prepared statement");
      }
      return query;
    });
    batchQueries.push(queries);

    if (
      failBatchOnQuery !== undefined &&
      queries.some((query) => query.includes(failBatchOnQuery))
    ) {
      throw new Error(`Injected batch failure for ${failBatchOnQuery}`);
    }

    for (const query of queries) {
      await runStatement(query);
    }
    return queries.map(() => ({ results: [] }));
  };

  return {
    appliedNames,
    batch: vi.fn(batch),
    batchQueries,
    executedQueries,
    prepare,
    exec: vi.fn(runStatement),
  };
};

describe("runRuntimeMigrations", () => {
  it("applies pending app migrations in order", async () => {
    const db = createStubD1Database();

    const report = await runRuntimeMigrations({
      db,
      appMigrations: [
        {
          name: "0000_first.sql",
          sql: "CREATE TABLE one (id integer);\n--> statement-breakpoint\nCREATE INDEX one_idx ON one (id);",
        },
        {
          name: "0001_second.sql",
          sql: "CREATE TABLE two (id integer);",
        },
      ],
    });

    expect(report).toEqual({
      applied: ["0000_first.sql", "0001_second.sql"],
      skipped: [],
    });
    expect(db.appliedNames).toEqual(
      new Set(["0000_first.sql", "0001_second.sql"]),
    );
    expect(db.batchQueries).toHaveLength(2);
    expect(db.batchQueries[0]).toEqual([
      "CREATE TABLE one (id integer)",
      "CREATE INDEX one_idx ON one (id)",
      "INSERT INTO d1_migrations (name) VALUES ('0000_first.sql')",
    ]);
    expect(db.batchQueries[0]![0]).not.toContain("--> statement-breakpoint");
    expect(db.batchQueries[1]![1]).toContain(
      "INSERT INTO d1_migrations (name) VALUES ('0001_second.sql')",
    );
  });

  it("skips migrations already tracked in d1_migrations", async () => {
    const db = createStubD1Database({
      initialAppliedNames: ["0000_first.sql"],
    });

    const report = await runRuntimeMigrations({
      db,
      appMigrations: [
        {
          name: "0000_first.sql",
          sql: "CREATE TABLE one (id integer);",
        },
        {
          name: "0001_second.sql",
          sql: "CREATE TABLE two (id integer);",
        },
      ],
    });

    expect(report).toEqual({
      applied: ["0001_second.sql"],
      skipped: ["0000_first.sql"],
    });
    expect(db.batchQueries).toHaveLength(1);
  });

  it("applies core migrations before app migrations", async () => {
    const db = createStubD1Database();

    await runRuntimeMigrations({
      db,
      coreMigrations: [
        {
          name: "0000_core.sql",
          sql: "CREATE TABLE core_table (id integer);",
        },
      ],
      appMigrations: [
        {
          name: "0001_app.sql",
          sql: "CREATE TABLE app_table (id integer);",
        },
      ],
    });

    expect(db.batchQueries).toEqual([
      [
        "CREATE TABLE core_table (id integer)",
        "INSERT INTO d1_migrations (name) VALUES ('0000_core.sql')",
      ],
      [
        "CREATE TABLE app_table (id integer)",
        "INSERT INTO d1_migrations (name) VALUES ('0001_app.sql')",
      ],
    ]);
  });

  it("does not commit migration SQL or history when a batched statement fails", async () => {
    const db = createStubD1Database({ failBatchOnQuery: "CREATE INDEX" });

    await expect(
      runRuntimeMigrations({
        db,
        appMigrations: [
          {
            name: "0000_atomic.sql",
            sql: "CREATE TABLE atomic_table (id integer);\nCREATE INDEX atomic_idx ON atomic_table (id);",
          },
        ],
      }),
    ).rejects.toThrow("Injected batch failure for CREATE INDEX");

    expect(db.batchQueries).toEqual([
      [
        "CREATE TABLE atomic_table (id integer)",
        "CREATE INDEX atomic_idx ON atomic_table (id)",
        "INSERT INTO d1_migrations (name) VALUES ('0000_atomic.sql')",
      ],
    ]);
    expect(db.executedQueries).toEqual([
      expect.stringContaining("CREATE TABLE IF NOT EXISTS d1_migrations"),
    ]);
    expect(db.appliedNames).not.toContain("0000_atomic.sql");
  });
});

describe("createApp runtime migrations", () => {
  it("runs configured runtime migrations only once per non-production binding", async () => {
    const db = createStubD1Database();
    const app = createApp({
      config: {
        database: {
          migrations: {
            app: [
              {
                name: "0000_first.sql",
                sql: "CREATE TABLE one (id integer);",
              },
            ],
          },
        },
      },
    });

    const env = {
      DB: db,
      WORKER_ENV: "test" as const,
      ASSETS: {
        fetch: vi.fn(),
      },
    } as any;

    const first = await app.request("/", {}, env);
    const second = await app.request("/", {}, env);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.executedQueries).toHaveLength(3);
  });

  it("skips configured runtime migrations by default in production", async () => {
    const db = createStubD1Database();
    const app = createApp({
      config: {
        database: {
          migrations: {
            app: [
              {
                name: "0000_first.sql",
                sql: "CREATE TABLE one (id integer);",
              },
            ],
          },
        },
      },
    });

    const env = {
      DB: db,
      WORKER_ENV: "production" as const,
      ASSETS: {
        fetch: vi.fn(),
      },
    } as any;

    const response = await app.request("/", {}, env);

    expect(response.status).toBe(200);
    expect(db.executedQueries).toHaveLength(0);
  });

  it("runs configured runtime migrations in production when enabled", async () => {
    const db = createStubD1Database();
    const app = createApp({
      config: {
        database: {
          migrations: {
            enabled: true,
            app: [
              {
                name: "0000_first.sql",
                sql: "CREATE TABLE one (id integer);",
              },
            ],
          },
        },
      },
    });

    const env = {
      DB: db,
      WORKER_ENV: "production" as const,
      ASSETS: {
        fetch: vi.fn(),
      },
    } as any;

    const response = await app.request("/", {}, env);

    expect(response.status).toBe(200);
    expect(db.executedQueries).toHaveLength(3);
  });

  it("uses the configured migration history table", async () => {
    const db = createStubD1Database();
    const app = createApp({
      config: {
        database: {
          migrations: {
            tableName: "cms_migration_history",
            app: [
              {
                name: "0000_first.sql",
                sql: "CREATE TABLE one (id integer);",
              },
            ],
          },
        },
      },
    });

    const response = await app.request("/", {}, {
      DB: db,
      WORKER_ENV: "test" as const,
      ASSETS: { fetch: vi.fn() },
    } as any);

    expect(response.status).toBe(200);
    expect(db.executedQueries[0]).toContain(
      "CREATE TABLE IF NOT EXISTS cms_migration_history",
    );
    expect(db.batchQueries[0]?.at(-1)).toBe(
      "INSERT INTO cms_migration_history (name) VALUES ('0000_first.sql')",
    );
  });
});
