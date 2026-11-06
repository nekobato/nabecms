# @nekobato/nabecms-core

[English](./README.md)

NabeCMS の Cloudflare Worker runtime、共有 contract、Hono RPC 型を提供する実装 package です。

通常の host app では、Admin assets も含む `@nekobato/nabecms` facade を使います。
新しいアプリの導入手順は [NabeCMS Quick Start](https://github.com/nekobato/nabecms/blob/main/docs/ja/getting-started.md) に記載しています。

## Public exports

```ts
import { createApp, defineConfig } from "@nekobato/nabecms-core";
import type { FieldType } from "@nekobato/nabecms-core/contracts";
import type { AdminAppType } from "@nekobato/nabecms-core/rpc/admin";
import type { ContentsAppType } from "@nekobato/nabecms-core/rpc/contents";
```

`Env` と `AppContext` も公開しています。
app を拡張する場合は、生成された Wrangler global 型に依存せず package の型を利用できます。

```ts
import { Hono } from "hono";
import type { AppContext } from "@nekobato/nabecms-core";

const app = new Hono<AppContext>();
```

monorepo の開発手順は [Developer Guide](https://github.com/nekobato/nabecms/blob/main/docs/ja/developer.md) に記載しています。

## License

ISC
