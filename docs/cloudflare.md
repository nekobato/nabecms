# Cloudflare requirements and configuration

The generated app runs its APIs and Admin UI on one Worker, with D1 for CMS data and a private R2 bucket for files.
Alpha.1 was tested on Workers Paid. Free plan behavior has yet to be verified.
For the order of operations, follow [first deployment](./operations.md#first-deployment).

## Cloudflare features

Allocate a D1 database and R2 bucket for the environment you deploy.
The Worker uses Workers Assets to serve the Admin UI and Workers Rate Limiting to protect authentication.
If you use image variants, the Worker calls Cloudflare image transformations (`cf.image`). Editors choose variants when they [upload media](./admin/index.md#manage-media).
Wrangler emulates D1 and R2 during [local setup](./getting-started.md).

## Fixed routes and bindings

Use the starter's binding names and update the resource names and IDs to match your deployment.

| Setting | Value |
| --- | --- |
| Worker compatibility flag | `nodejs_compat` |
| Admin UI route | `/admin` |
| D1 binding | `DB` |
| Private R2 binding | `R2` |
| Workers Assets binding | `ASSETS` |
| `assets.directory` | `./node_modules/@nekobato/nabecms/admin/dist` |
| `assets.not_found_handling` | `single-page-application` |
| `assets.run_worker_first` | `true` |
| Sign-in Rate Limiting binding | `AUTH_LOGIN_RATE_LIMITER`, 10 requests per 60 seconds |
| Other authentication Rate Limiting binding | `AUTH_SENSITIVE_RATE_LIMITER`, 5 requests per 60 seconds |

The Worker must handle API requests and `robots.txt` before the SPA fallback serves Admin UI routes such as `/admin/models/create`.
The media routes enforce [the publication rules](./security.md#media-delivery), so keep the bucket private.

Production requires both rate limit bindings. Define `ratelimits` in `env.production` because named environments do not inherit them.
Use different positive integer strings for the two `namespace_id` values, unique within the Cloudflare account.
Run `pnpm nabecms:doctor` to check the names, limits, and namespace IDs.
See [rate limiting](./security.md#rate-limiting) for how these settings affect authentication requests.

## Environment variables and Secrets

| Name | Purpose | Where to set it |
| --- | --- | --- |
| `WORKER_ENV` | Selects `development` or `production` behavior | Wrangler `vars` |
| `BOOTSTRAP_SECRET` | Required to initialize the first administrator | `.dev.vars` locally, Cloudflare Secrets in production |
| `JWT_SECRET` | Required in production. Signs Admin API tokens, among other uses | `.dev.vars` locally, Cloudflare Secrets in production |
| `BETTER_AUTH_URL` | Public origin for Better Auth | Wrangler `vars` |
| `BETTER_AUTH_SECRET` | Protects Better Auth sessions | `.dev.vars` locally, Cloudflare Secrets in production |
| `ADMIN_DEV_PROXY` / `ADMIN_DEV_PORT` | Configure the Admin UI dev server connection | Local development environment |

The starter configures both `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET`. Supply both to use Better Auth sessions.
Set the URL to the origin users open, using HTTPS in production.
See [secret management](./security.md#secret-management) for handling secrets and [authentication email](./email.md) for the settings needed to send mail.

## D1 limits

Cloudflare limits D1 queries per Worker invocation according to the plan.
Bulk publishing reads each selected entry and its revision individually before writing, so a large selection can exceed the plan's limit.
See [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

NabeCMS also applies a separate statement budget to bulk publishing.
See [Admin API entries](./api/admin.md#entries) for the API limits and what to do when the request exceeds them.
