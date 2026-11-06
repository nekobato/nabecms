# @nekobato/nabecms-admin

[English](./README.md)

NabeCMS Admin UI のビルド済み静的ファイルを提供する実装パッケージです。
通常のアプリでは、Worker runtime も含む `@nekobato/nabecms` を使用します。
導入手順は[クイックスタート](https://github.com/nekobato/nabecms/blob/main/docs/ja/getting-started.md)、画面での操作は [Admin UI ガイド](https://github.com/nekobato/nabecms/blob/main/docs/ja/admin/index.md) に記載しています。

## Assets path

`@nekobato/nabecms` を使う場合は `./node_modules/@nekobato/nabecms/admin/dist`、このパッケージを直接使う場合は `./node_modules/@nekobato/nabecms-admin/dist` を配信します。
Workers Assets は [Cloudflare の前提と設定](https://github.com/nekobato/nabecms/blob/main/docs/ja/cloudflare.md) に従って設定します。

第三者パッケージの license と NOTICE は `dist/THIRD_PARTY_NOTICES.txt` に含まれます。

## License

ISC
