# @nekobato/nabecms

[日本語](https://github.com/nekobato/nabecms/blob/main/packages/nabecms/README.ja.md)

This package provides the public API for the Cloudflare Worker runtime and the prebuilt NabeCMS Admin UI.
Use this package in a typical host app.

For app creation instructions, see the [Quick Start](https://github.com/nekobato/nabecms/blob/main/docs/getting-started.md).

```bash
npm create nabecms@next my-cms
```

## Public API

```ts
import { createApp, defineConfig } from "@nekobato/nabecms";
import type { FieldType } from "@nekobato/nabecms/contracts";
import type { AdminAppType } from "@nekobato/nabecms/rpc/admin";
import type { ContentsAppType } from "@nekobato/nabecms/rpc/contents";
```

For available settings and import paths, see the [configuration reference](https://github.com/nekobato/nabecms/blob/main/docs/configuration.md).

## Admin assets

The prebuilt files are available at `./node_modules/@nekobato/nabecms/admin/dist`.
For Workers Assets configuration, see [Cloudflare requirements](https://github.com/nekobato/nabecms/blob/main/docs/cloudflare.md).
Third-party licenses and notices are bundled in `admin/dist/THIRD_PARTY_NOTICES.txt`.

## License

ISC
