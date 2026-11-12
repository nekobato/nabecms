# Quick Start

Create a CMS app, sign in, and publish an article on a local Worker.
Wrangler runs D1 and R2 locally, so you can try the CMS before creating Cloudflare resources.

## Prerequisites

Use Node.js 24.22.3 or later within 24.x, or 26.13.1 or later within 26.x, and pnpm 11 or later.
The initializer includes Wrangler in the app's dependencies.
A Cloudflare account is needed when you [deploy the app](./operations.md).

## Install the Alpha

The first preview release is `0.1.0-alpha.1`. The npm `next` tag points to the latest Alpha release.
Alpha updates may change APIs or configuration incompatibly. Read the target version's [GitHub Release](https://github.com/nekobato/nabecms/releases) before upgrading an app with existing data.

## Generate an app

```bash
npm create nabecms@next my-cms
cd my-cms
```

The initializer creates the app and runs `pnpm install`. It pins the runtime and CLI to its own version so they start on the same release.
To select the first Alpha explicitly, run `npm create nabecms@0.1.0-alpha.1 my-cms`.

## Configure local secrets

Create the local secrets file in the app directory.

```bash
cp .dev.vars.example .dev.vars
```

Replace `BOOTSTRAP_SECRET`, `JWT_SECRET`, and `BETTER_AUTH_SECRET` in `.dev.vars` with three different values.
Run this command once for each secret.

```bash
openssl rand -hex 32
```

Keep `BOOTSTRAP_SECRET` available for the setup screen. The other two values protect API tokens and sign-in sessions.
Keep `.dev.vars` out of Git. See [secret management](./security.md#secret-management) when moving to production.

## Run locally

Apply the database migrations, check the local configuration and types, then start the Worker.

```bash
pnpm nabecms:migrate --local
pnpm nabecms:doctor
pnpm typecheck
pnpm dev
```

Open `http://localhost:8787/admin/` to reach the setup screen.

## Publish your first article

1. Enter your name, email, password, and default locale on the setup screen. Supply the `BOOTSTRAP_SECRET` from `.dev.vars` to create the first administrator.
2. Sign in and create an Articles model under **Models**. Add a `text` field for the title and a `rich_text` field for the body.
3. Open **Contents**, create an entry in the Articles model, and fill in the title and body. Select **Publish** to make the article available to delivery clients.

To read the article from another app, create a key with `contents:read` and use the [Contents API](./api/contents.md). See the [Admin UI guide](./admin/index.md#manage-entries) for how drafts, published content, and revisions relate.

## Next steps

When the app works locally, follow [operations and deployment](./operations.md) to set up the production Worker, database, and bucket.
Check the [Cloudflare requirements](./cloudflare.md) before choosing a plan.
If you are modifying NabeCMS itself, use the [developer guide](./developer.md) for the source checkout.
