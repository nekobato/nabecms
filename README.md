[![CI](https://github.com/nekobato/nabecms/actions/workflows/ci.yml/badge.svg)](https://github.com/nekobato/nabecms/actions/workflows/ci.yml)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/public/logo-dark.svg" />
    <img src="./docs/public/logo.svg" alt="NabeCMS logo" width="96" height="96" />
  </picture>
</p>

# NabeCMS

[日本語](./README.ja.md)

NabeCMS is a headless CMS for Cloudflare Workers.
Define content models and edit articles in the Admin UI, then deliver them through the API.
Deploy the Admin UI and API to a single Worker. D1 stores the data, and a private R2 bucket stores images and other files.

## Features

- Typed fields and multilingual content
- Drafts, publishing, and revision restoration
- Navigation and editing across related entries
- Media uploads and delivery based on publication status
- Role-based administration and API key access for content delivery
- Activity log search and retention, with optional authentication email

See the [Admin UI guide](./docs/admin/index.md) and [API overview](./docs/api/index.md).

## Get started

```bash
npm create nabecms@next my-cms
```

`next` points to the latest Alpha release.
For prerequisites, secret configuration, and startup instructions, see the [Quick Start](./docs/getting-started.md).

Alpha releases may include breaking changes to APIs and configuration.
Check each version's [GitHub Release](https://github.com/nekobato/nabecms/releases) for migration instructions before upgrading.
Alpha.1 was tested on Workers Paid.

## Documentation

| I want to | Guide |
| --- | --- |
| Set up NabeCMS | [Quick Start](./docs/getting-started.md) |
| Deploy to Cloudflare | [Operations and deployment](./docs/operations.md) |
| Change application settings | [Configuration reference](./docs/configuration.md) |
| Migrate data | [Data management](./docs/data-management.md) |
| Configure authentication and access | [Security](./docs/security.md) |
| Send invitations and password reset emails | [Authentication email](./docs/email.md) |
| Contribute to NabeCMS | [Developer guide](./docs/developer.md) |
| Understand the system | [Architecture](./docs/architecture.md) |

## License

[ISC](./LICENSE)
