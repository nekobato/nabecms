import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { z } from "zod";

const TEST_ORIGIN = "https://cms.example.test";
const DRIZZLE_EXPORT_TIMEOUT_MS = 30_000;
const DRIZZLE_EXPORT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const require = createRequire(import.meta.url);
const drizzleKitBinaryPath = join(
  dirname(require.resolve("drizzle-kit")),
  "bin.cjs",
);
const devPackagePath = fileURLToPath(new URL("../dev/", import.meta.url));

type FixtureChecksumManifest = {
  algorithm: "sha256";
  files: Record<string, string>;
  source: string;
};

/**
 * Export executable SQLite DDL directly from the TypeScript source schema.
 *
 * The exporter deliberately invokes Node without a shell or package-manager
 * shim and rejects empty output, timeouts, and any stderr warning so the drift
 * gate cannot silently compare an incomplete schema.
 */
const exportSourceSchemaSql = async (): Promise<string> =>
  await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [drizzleKitBinaryPath, "export", "--config", "drizzle.config.ts"],
      {
        cwd: devPackagePath,
        encoding: "utf8",
        maxBuffer: DRIZZLE_EXPORT_MAX_BUFFER_BYTES,
        timeout: DRIZZLE_EXPORT_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        const diagnostic = stderr.trim();
        if (error) {
          const reason = error.killed
            ? `timed out after ${DRIZZLE_EXPORT_TIMEOUT_MS}ms`
            : "failed";
          reject(
            new Error(
              `drizzle-kit export ${reason}: ${diagnostic || error.message}`,
              { cause: error },
            ),
          );
          return;
        }
        if (diagnostic.length > 0) {
          reject(
            new Error(`drizzle-kit export wrote to stderr: ${diagnostic}`),
          );
          return;
        }

        const sql = stdout.trim();
        if (sql.length === 0) {
          reject(new Error("drizzle-kit export returned empty SQL"));
          return;
        }
        resolve(sql);
      },
    );
  });

/**
 * Verify the immutable 0.0.1 fixture before parsing it as D1 migrations.
 */
const readVerifiedV001Migrations = async () => {
  const fixtureRoot = fileURLToPath(
    new URL("./test/fixtures/nabecms-0.0.1/", import.meta.url),
  );
  const migrationsPath = fileURLToPath(
    new URL("./test/fixtures/nabecms-0.0.1/migrations", import.meta.url),
  );
  const manifest = JSON.parse(
    await readFile(`${fixtureRoot}/checksums.json`, "utf8"),
  ) as FixtureChecksumManifest;
  if (manifest.algorithm !== "sha256") {
    throw new Error(
      `Unsupported 0.0.1 fixture checksum algorithm: ${manifest.algorithm}`,
    );
  }

  const expectedNames = Object.keys(manifest.files).toSorted();
  const actualNames = (await readdir(migrationsPath))
    .filter((name) => name.endsWith(".sql"))
    .toSorted();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `NabeCMS 0.0.1 fixture files differ from checksums.json (${manifest.source})`,
    );
  }

  await Promise.all(
    expectedNames.map(async (name) => {
      const contents = await readFile(`${migrationsPath}/${name}`);
      const checksum = createHash("sha256").update(contents).digest("hex");
      if (checksum !== manifest.files[name]) {
        throw new Error(`NabeCMS 0.0.1 fixture checksum mismatch: ${name}`);
      }
    }),
  );

  return await readD1Migrations(migrationsPath);
};

/** Read the canonical Drizzle snapshot used by full-schema D1 assertions. */
const readCurrentSchemaSnapshot = async () => {
  const snapshot: unknown = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL("../dev/migrations/meta/0010_snapshot.json", import.meta.url),
      ),
      "utf8",
    ),
  );
  return z.json().parse(snapshot);
};

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrationsPath = fileURLToPath(
        new URL("../dev/migrations", import.meta.url),
      );
      const migrations = await readD1Migrations(migrationsPath);
      const [v001Migrations, currentSchemaSnapshot, sourceSchemaSql] =
        await Promise.all([
          readVerifiedV001Migrations(),
          readCurrentSchemaSnapshot(),
          exportSourceSchemaSql(),
        ]);

      return {
        wrangler: {
          configPath: "../../wrangler.test.jsonc",
        },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            NABECMS_001_MIGRATIONS: v001Migrations,
            CURRENT_SCHEMA_SNAPSHOT: currentSchemaSnapshot,
            SOURCE_SCHEMA_SQL: sourceSchemaSql,
            BETTER_AUTH_SECRET: "nabecms-real-d1-integration-secret-32-bytes",
            BETTER_AUTH_URL: TEST_ORIGIN,
            BOOTSTRAP_SECRET: "nabecms-real-d1-bootstrap-secret",
            JWT_SECRET: "nabecms-real-d1-jwt-secret-32-bytes-long",
            BCRYPT_COST: "4",
          },
          d1Databases: {
            DB: "nabecms-fresh-test-db",
            LEGACY_DB: "nabecms-legacy-test-db",
            SOURCE_SCHEMA_DB: "nabecms-source-schema-test-db",
          },
        },
      };
    }),
  ],
  test: {
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 15000,
    globals: true,
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "test/", "*.config.ts"],
    },
  },
});
