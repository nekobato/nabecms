# Operations and deployment

Deploy the app from the [Quick Start](./getting-started.md) with its own production D1 database and R2 bucket.
Run these commands from the app directory. Check the [Cloudflare requirements](./cloudflare.md) before provisioning resources.

## First deployment

### Create resources

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create my-cms-production
pnpm exec wrangler r2 bucket create my-cms-media
```

Put the resulting `database_name`, `database_id`, and `bucket_name` in `wrangler.jsonc`.
Set the Worker name and check the resource values in both the top-level configuration and `env.production`.
Keep the bucket private so files are served through the Worker.

In `env.production.ratelimits`, replace the placeholder namespace IDs with unused values as described in [routes and bindings](./cloudflare.md#fixed-routes-and-bindings).
Set `BETTER_AUTH_URL` to the HTTPS origin where users will sign in.

### Set Secrets

Generate three separate random values for production. For the purpose of each value, see [environment variables and Secrets](./cloudflare.md#environment-variables-and-secrets).
Enter the values at the prompts so the secrets stay out of configuration files and Git history.

```bash
pnpm exec wrangler secret put BOOTSTRAP_SECRET --env production
pnpm exec wrangler secret put JWT_SECRET --env production
pnpm exec wrangler secret put BETTER_AUTH_SECRET --env production
```

### Check and deploy

```bash
pnpm nabecms:doctor
pnpm typecheck
pnpm deploy
```

The starter's `deploy` script applies the production D1 migrations before deploying the Worker.
The doctor command validates local configuration. After deploying, open `/admin` and create the first administrator with the production `BOOTSTRAP_SECRET`. The new D1 database starts without your local accounts and articles.

Sign in, publish a test entry, and upload and open a test file. These checks exercise the production session, D1, and R2 connections.

## Upgrades and the database

Start an upgrade by reading the target version's [GitHub Release](https://github.com/nekobato/nabecms/releases) for compatibility and migration steps.
Back up D1 and R2, then update the packages and test the migration and app locally before changing production.

Production disables request-time migrations by default.
If you manage deployment yourself, apply the migration before replacing the Worker.

```bash
pnpm nabecms:migrate --remote --env production
```

For the migration files and custom tables, see [data management](./data-management.md#migrations).

## Media operations

Deliver files through the Worker so each request is subject to the [media access rules](./security.md#media-delivery).
When you delete media, the Worker removes the database record first. `204 No Content` confirms that change.
Subsequent requests that look up the record return `404`. A request that already passed the lookup can finish, and previously downloaded copies remain available to their recipients.

The Worker then tries to remove the original and variants from R2. It logs the media ID and object key on failure and continues with the other keys.
An interruption or concurrent image transformation can leave an object in the bucket even when there is no log entry. A repeat DELETE for the same ID returns `404`.

To remove a leftover object, identify its exact key, check that no current original or variant record refers to it, and wait for writes to that key to finish before removing it from R2.

## Caching

The Contents API and media routes return `Cache-Control: private, no-store`.
Shared caches can serve a response to the wrong API key or keep serving it after the publication state changes. Keep these responses out of CDN and shared proxy caches.
Use `ETag` and `Last-Modified` as metadata when inspecting responses.

## Request logs and troubleshooting

Find the response's `X-NABECMS-Request-Id` in Cloudflare Workers Logs to diagnose a request.
In production, `event: "nabecms.api_request"` identifies Admin API and Contents API requests. Each record includes `requestId`, `scope`, `routeGroup`, `status`, and `durationMs`. Contents API records include `modelId` and `apiKeyId` when available.
Request logs omit credentials, bodies, query strings, IP addresses, and email addresses.

The [structured logging setting](./configuration.md#options) controls normal request logs.
Rate limit violations and binding failures are recorded as `event: "nabecms.auth_rate_limit"` even when that setting is off.

| Symptom | What to check |
| --- | --- |
| `401` / `403` | Session, API key permissions, and `allowedModels` |
| `500` | D1 binding, database connection, and migration status |
| `429` on an authentication endpoint | Check `Retry-After` and rate limit logs before retrying |
| `503 AUTH_RATE_LIMIT_UNAVAILABLE` | Repair production `ratelimits`, namespace IDs, and bindings |
| `404` for media | D1 media record, R2 object key, and `R2` binding |

## Scheduled log cleanup

The starter runs cleanup daily at 18:00 UTC (03:00 JST the next day).
Super Admins set the retention period in [Log management](./admin/index.md#log-management).
Apply migrations before the first scheduled run, since cleanup uses the existing D1 schema.

In a custom Worker, keep your HTTP handler and call `runLogCleanup(env)` from the scheduled handler.

```ts
import { createApp, runLogCleanup, type Env } from "@nekobato/nabecms";
import config from "../nabecms.config";

const app = createApp({ config });
export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runLogCleanup(env);
  },
};
```

Set `"triggers": { "crons": ["0 18 * * *"] }` for the environment you deploy.
If you use named environments, set it in `env.production` as well and merge it with existing triggers.

A run deletes up to 2,500 records per log table, in batches of 500, and stops starting new batches after about 20 seconds. Remaining records carry over to the next run.
If the Admin UI keeps reporting expired logs, check the result of the last run before increasing the schedule frequency.

If a run fails, check the Cron configuration, applied migrations, and Workers Logs. `LOG_RETENTION_SETTINGS_ERROR` points to reading or validating the policy. `LOG_CLEANUP_DATABASE_ERROR` points to D1.
If D1 could not save the end state, compare the recorded start time with Workers Logs. A subsequent scheduled run retries cleanup after the cause is resolved.

For immediate cleanup, call `runLogCleanup(env)` from trusted Worker code with the same D1 binding.
To pause cleanup, set retention to indefinite or remove the Cron trigger. A running job still uses the settings it read at the start.
Restoring deleted logs requires a backup.
