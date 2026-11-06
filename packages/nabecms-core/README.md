# @nekobato/nabecms-core

[日本語](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/README.ja.md)

The implementation package provides the NabeCMS Cloudflare Worker runtime, shared contracts, and Hono RPC types.

A typical host app uses the `@nekobato/nabecms` facade, which includes Admin assets.
For app setup, see the [NabeCMS Quick Start](https://github.com/nekobato/nabecms/blob/main/docs/getting-started.md).

## Public exports

```ts
import { createApp, defineConfig } from "@nekobato/nabecms-core";
import type { FieldType } from "@nekobato/nabecms-core/contracts";
import type { AdminAppType } from "@nekobato/nabecms-core/rpc/admin";
import type { ContentsAppType } from "@nekobato/nabecms-core/rpc/contents";
```

The package also exports `Env` and `AppContext`.
Use these types when extending an app independently of Wrangler's generated global types.

```ts
import { Hono } from "hono";
import type { AppContext } from "@nekobato/nabecms-core";

const app = new Hono<AppContext>();
```

For monorepo development, see the [developer guide](https://github.com/nekobato/nabecms/blob/main/docs/developer.md).

## License

ISC
