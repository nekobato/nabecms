# `nabecms.config.ts` reference

Use `nabecms.config.ts` for options that control the CMS at runtime. Wrangler configuration supplies the Cloudflare bindings and environment variables.
The starter's [configuration](https://github.com/nekobato/nabecms/blob/main/packages/create-nabecms/template/basic/nabecms.config.ts) uses `defineConfig()`. Its [Worker entry point](https://github.com/nekobato/nabecms/blob/main/packages/create-nabecms/template/basic/src/worker.ts) passes that configuration to `createApp()`, which validates it and rejects unknown options.

## Options

### Database migrations

Production applies migrations during deployment by default. See [data management](./data-management.md#migrations) for the workflow.

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `database.migrations.enabled` | `boolean` | `false` in production, `true` elsewhere | Runs migrations when handling requests |
| `database.migrations.tableName` | `string` | `d1_migrations` | Names the history table. Use a valid SQL identifier |
| `database.migrations.app` | `RuntimeMigration[]` | `[]` | Applies app migrations in declaration order |
| `database.migrations.app[].name` | `string` | None | A unique, nonempty migration name |
| `database.migrations.app[].sql` | `string` | None | Nonempty SQL to apply |

### Admin development server

Use these options for the Admin UI proxy in development. In production, the Worker serves the built UI through the [Assets binding](./cloudflare.md#fixed-routes-and-bindings).

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `admin.devServer.enabled` | `boolean` | `ADMIN_DEV_PROXY`, or `true` if unset | Enables the proxy when `WORKER_ENV=development` |
| `admin.devServer.port` | Positive integer | `ADMIN_DEV_PORT`, or `2525` if unset | Sets the development server port |
| `admin.devServer.host` | `string` | `127.0.0.1` | Sets the development server host |

### Request logging

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `observability.structuredLogs.enabled` | `boolean` | `false` in tests or without an environment, `true` elsewhere | Writes structured Admin API and Contents API request logs to `console.log` |

For log fields and troubleshooting, see [request logs](./operations.md#request-logs-and-troubleshooting).

## Import paths

| Import path | Purpose |
| --- | --- |
| `@nekobato/nabecms` | `createApp`, configuration, and public Worker types |
| `@nekobato/nabecms/contracts` | Field and JSON contracts shared with clients |
| `@nekobato/nabecms/rpc/admin` | Admin API Hono RPC types |
| `@nekobato/nabecms/rpc/contents` | Contents API Hono RPC types |

Use these exports when importing from the package.

## Settings in the Admin UI

Super Admins change [log retention](./admin/index.md#log-management) and [authentication email](./email.md) in the Admin UI.
