/// <reference types="@cloudflare/vitest-plugin/types" />
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { createAccessToken } from "./lib/auth";
import { SUPER_ADMIN_ROLE_ID } from "./lib/system-roles";
import routes from "./routes/admin/export";

type Database = Parameters<typeof applyD1Migrations>[0];
const bindings = env as unknown as {
  DB: Database;
  TEST_MIGRATIONS: D1Migration[];
};
const db = bindings.DB;
const secret = "export-test-secret-32-bytes-long";
const actorId = "export-admin";
const sessionId = "export-session";

beforeAll(async () => {
  await applyD1Migrations(db, bindings.TEST_MIGRATIONS);
  await db.batch([
    db
      .prepare("INSERT INTO users (id, email) VALUES (?, ?)")
      .bind(actorId, "export-admin@example.test"),
    db
      .prepare(
        "INSERT INTO auth_sessions (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        sessionId,
        actorId,
        "export-token",
        Date.now() + 86_400_000,
        Date.now(),
        Date.now(),
      ),
    db.prepare(
      "INSERT INTO models (id, name) VALUES ('export-model', 'Export model')",
    ),
    db.prepare("INSERT INTO locales (code, is_default) VALUES ('en', 1)"),
    db.prepare(
      "INSERT INTO model_fields (id, model_id, name, field_key, type, position, required, has_locales, variant) VALUES ('gallery', 'export-model', 'Gallery', 'gallery', 'media', 0, 0, 0, 'multiple')",
    ),
    db.prepare(
      "INSERT INTO model_fields (id, model_id, name, field_key, type, position, required, has_locales) VALUES ('metadata', 'export-model', 'Metadata', 'metadata', 'json', 1, 0, 0)",
    ),
    db
      .prepare(
        "INSERT INTO media (id, group_id, url, type, mime_type, name, size, updated_by) VALUES ('media-present', 'group', 'media/file', 'image', 'image/png', 'Image', 1, ?)",
      )
      .bind(actorId),
  ]);

  for (let start = 0; start < 1_001; start += 100) {
    const statements = [];
    for (let index = start; index < Math.min(start + 100, 1_001); index += 1) {
      const entryId = `archived-${String(index).padStart(4, "0")}`;
      const fields =
        index === 0
          ? [
              {
                fieldId: "metadata",
                locale: "en",
                valueJson: { version: "old" },
              },
            ]
          : [];
      statements.push(
        db
          .prepare(
            "INSERT INTO entries (id, model_id, status, updated_by) VALUES (?, 'export-model', 'archived', ?)",
          )
          .bind(entryId, actorId),
        db
          .prepare(
            "INSERT INTO entry_revisions (id, entry_id, revision_number, content, status, created_by) VALUES (?, ?, 1, ?, 'archived', ?)",
          )
          .bind(
            `revision-${entryId}`,
            entryId,
            JSON.stringify({ fields }),
            actorId,
          ),
      );
    }
    await db.batch(statements);
  }
  await db.batch([
    db
      .prepare(
        "INSERT INTO entry_revisions (id, entry_id, revision_number, content, status, created_by) VALUES ('revision-archived-latest', 'archived-0000', 2, ?, 'archived', ?)",
      )
      .bind(
        JSON.stringify({
          fields: [
            {
              fieldId: "gallery",
              locale: "en",
              valueJson: ["media-present", "media-missing"],
              valueMedia: null,
            },
            {
              fieldId: "metadata",
              locale: "en",
              valueJson: ["not-a-media-id"],
            },
          ],
        }),
        actorId,
      ),
  ]);
  for (let start = 0; start < 501; start += 100) {
    const statements = [];
    for (let index = start; index < Math.min(start + 100, 501); index += 1) {
      const entryId = `published-${String(index).padStart(4, "0")}`;
      statements.push(
        db
          .prepare(
            "INSERT INTO entries (id, model_id, status, published_revision_id, current_draft_revision_id, updated_by) VALUES (?, 'export-model', 'published', ?, ?, ?)",
          )
          .bind(
            entryId,
            `published-revision-${entryId}`,
            `draft-revision-${entryId}`,
            actorId,
          ),
        db
          .prepare(
            "INSERT INTO entry_revisions (id, entry_id, revision_number, content, status, created_by) VALUES (?, ?, 1, ?, 'published', ?)",
          )
          .bind(
            `published-revision-${entryId}`,
            entryId,
            JSON.stringify({
              fields: [{ fieldId: "metadata", valueJson: { version: 1 } }],
            }),
            actorId,
          ),
        db
          .prepare(
            "INSERT INTO entry_revisions (id, entry_id, revision_number, content, status, created_by) VALUES (?, ?, 2, ?, 'draft', ?)",
          )
          .bind(
            `draft-revision-${entryId}`,
            entryId,
            JSON.stringify({
              fields: [{ fieldId: "metadata", valueJson: { version: 2 } }],
            }),
            actorId,
          ),
      );
    }
    await db.batch(statements);
  }
});

it("exports archived and current revisions within the D1 query budget and warns about missing multiple media", async () => {
  let queryCount = 0;
  const countedDb = {
    prepare(query: string) {
      queryCount += 1;
      return db.prepare(query);
    },
    batch: (statements: Parameters<Database["batch"]>[0]) =>
      db.batch(statements),
    exec: (query: string) => db.exec(query),
    dump: () => db.dump(),
  } as Database;
  const token = await createAccessToken(secret, {
    sub: actorId,
    email: "export-admin@example.test",
    roles: [SUPER_ADMIN_ROLE_ID],
    sid: sessionId,
  });
  const response = await routes.request(
    "/api/admin/export/content",
    { headers: { Authorization: `Bearer ${token}` } },
    { DB: countedDb, JWT_SECRET: secret },
  );
  expect(response.status).toBe(200);
  expect(queryCount).toBeLessThan(800);

  const exported = (await response.json()) as {
    counts: { entries: number; warnings: number };
    entries: Array<{
      id: string;
      archivedFields?: Array<{ fieldId: string; valueJson: unknown }>;
      publishedFields?: Array<{ valueJson: unknown }>;
      draftFields?: Array<{ valueJson: unknown }>;
    }>;
    warnings: string[];
  };
  expect(exported.counts.entries).toBe(1_502);
  expect(
    exported.entries.find((entry) => entry.id === "archived-0000")
      ?.archivedFields,
  ).toEqual([
    expect.objectContaining({
      fieldId: "gallery",
      valueJson: ["media-present", "media-missing"],
    }),
    expect.objectContaining({
      fieldId: "metadata",
      valueJson: ["not-a-media-id"],
    }),
  ]);
  expect(
    exported.entries.find((entry) => entry.id === "archived-1000")
      ?.archivedFields,
  ).toEqual([]);
  expect(
    exported.entries.find((entry) => entry.id === "published-0500"),
  ).toMatchObject({
    publishedFields: [expect.objectContaining({ valueJson: { version: 1 } })],
    draftFields: [expect.objectContaining({ valueJson: { version: 2 } })],
  });
  expect(exported.warnings).toEqual([
    "Entry archived-0000: media media-missing is missing.",
  ]);
  expect(exported.counts.warnings).toBe(1);
}, 60_000);
