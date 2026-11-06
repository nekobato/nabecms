# Data management

Back up D1 and the corresponding R2 files when you need to recover a NabeCMS deployment.
To move articles to a different CMS, export the content as JSON and download the files it references.
For the order of an upgrade, see [operations and deployment](./operations.md#upgrades-and-the-database).

## Export data for another CMS

A Super Admin opens **Settings → General** and selects **Open export** to download content and logs as separate JSON files.
These files are inputs for a migration to the destination system. Plan the format conversion and import in the destination system.

### Content file

`GET /api/admin/export/content` returns `format: "nabecms-content-export"`, `version: 1`, `exportedAt`, record `counts`, and the collections below.

| Key | Contents |
| --- | --- |
| `models` | Model definitions and their `fields`, including types, settings, defaults, and visibility |
| `locales` | Locale codes and the default locale |
| `entries` | IDs, status, timestamps, `publishedFields`, `draftFields`, and `archivedFields` |
| `media` | File metadata and a `downloadPath` for each original |
| `warnings` | Missing snapshots and unresolved references to fields, locales, media, or related entries |

A published entry has a published snapshot and may have a separate unpublished draft. An unpublished entry has its latest draft, and an archived entry has the values from its last revision.
The file omits earlier revisions, scheduled publishing, plugins, webhooks, credentials, users and roles, and custom app tables.

To map a field, match `fieldId` in `entries[].publishedFields[]` to `models[].fields[].id` to find its `fieldKey` and type.
Match `valueRelation` to entry IDs and `valueMedia` to media IDs. A multiple-media field stores its IDs in `valueJson`.
Check `warnings` for references that could not be matched. Review embedded URLs and references in rich text and JSON separately because the exporter leaves those values intact.

Download media files separately through the authenticated Admin API at each `downloadPath`.
The JSON contains the metadata without verifying that the file still exists in R2.

### Log file

`GET /api/admin/export/logs` returns `format: "nabecms-log-export"`, `version: 1`, `exportedAt`, per-type `counts`, `auditLogs`, and `authLoginEvents`.
Activity log `before` and `after` use the same allowed fields as the [log API](./api/admin.md#audit-and-authentication-logs).
The export includes stored logs, excluding revision history, Workers Logs, and records removed by retention.

Both exports read tables in sequence. Pause edits and media operations if the files must describe the same point in time.
The endpoints return a JSON error when they cannot produce a complete file. The limits are 50,000 rows per table and 25 MiB of JSON. Extract data directly from D1 if you exceed them.

## Migrations

The app owns the SQL files in `migrations/`. Review generated SQL before applying it. `pnpm nabecms:doctor` checks the bindings, local environment, and migration directory.
`pnpm db:generate` and `pnpm nabecms:migrate` also update the generated runtime bundle in `src/database/runtime-migrations.generated.ts`.

Apply a migration locally first, then follow the [upgrade procedure](./operations.md#upgrades-and-the-database) for production.
Production disables request-time migrations by default. If your app needs them, set `database.migrations.enabled: true` in `nabecms.config.ts`. The runner requires a binding that supports D1 `batch()` and commits a migration with its history entry, so a failed statement leaves the migration unapplied.

## Extend the schema

Core owns the CMS tables and their migration order. Use separate tables in the host app's `src/database/schema.ts` for app-specific data and connect them to CMS records by ID.

### Host app schema conventions

Name a custom table `app_<name>`. Use `app_<table>_<purpose>_idx` for an index and `app_<table>_<purpose>_unique` for a unique index.
Use IDs such as `entry_id` or `model_id` to connect the data to core tables.

### Workflow

Update `src/database/schema.ts`, then generate, check, and apply the change locally.

```bash
pnpm db:generate
pnpm nabecms:doctor
pnpm nabecms:migrate --local
```

Check the app against the migrated database before applying the same migration in production.
The starter applies it as part of deployment. See [upgrades and the database](./operations.md#upgrades-and-the-database) for a custom deployment.

## Breaking changes

Deleting a model also removes its entries, fields, and revisions. Deleting a field removes its stored values.
Review existing entries before changing a field type because some values may become invalid.
A change to `fieldKey` changes the key clients receive, so update consumers that use it.
