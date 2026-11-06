# @nekobato/nabecms

[English](./README.md)

Cloudflare Worker runtime の公開 API と、ビルド済み Admin UI を提供する NabeCMS のパッケージです。
通常のアプリはこのパッケージを使用します。

新しいアプリは[クイックスタート](https://github.com/nekobato/nabecms/blob/main/docs/ja/getting-started.md)の手順で作成します。

```bash
npm create nabecms@next my-cms
```

## 公開 API

```ts
import { createApp, defineConfig } from "@nekobato/nabecms";
import type { FieldType } from "@nekobato/nabecms/contracts";
import type { AdminAppType } from "@nekobato/nabecms/rpc/admin";
import type { ContentsAppType } from "@nekobato/nabecms/rpc/contents";
```

公開設定と import path は[設定リファレンス](https://github.com/nekobato/nabecms/blob/main/docs/ja/configuration.md)に記載しています。

## Admin assets

同梱ファイルは `./node_modules/@nekobato/nabecms/admin/dist` にあります。
Workers Assets は [Cloudflare の前提と設定](https://github.com/nekobato/nabecms/blob/main/docs/ja/cloudflare.md) に従って設定します。
第三者パッケージの license と NOTICE は `admin/dist/THIRD_PARTY_NOTICES.txt` に同梱します。

## License

ISC
