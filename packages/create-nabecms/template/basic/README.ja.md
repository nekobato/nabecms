# __PROJECT_NAME__

[English](./README.md)

NabeCMS `__NABECMS_VERSION__` の initializer から生成したアプリです。
`@nekobato/nabecms` を使い、Cloudflare Workers 上で API と Admin UI を動かします。

## ローカル起動

起動前に `.dev.vars.example` をコピーし、各シークレットを別々のランダム値へ置き換えます。
シークレットの生成手順と前提ツールは[クイックスタート](https://github.com/nekobato/nabecms/blob/main/docs/ja/getting-started.md)に記載しています。

```bash
cp .dev.vars.example .dev.vars
# .dev.vars のシークレットを設定する
pnpm nabecms:migrate --local
pnpm nabecms:doctor
pnpm typecheck
pnpm dev
```

管理画面は `http://localhost:8787/admin/` です。

## デプロイと更新

配備前に Cloudflare のリソースと Secrets を設定します。
本番環境は[運用とデプロイ](https://github.com/nekobato/nabecms/blob/main/docs/ja/operations.md)の手順で構成します。

Alpha 期間は API や設定に互換性のない変更が入る可能性があります。
アップグレード時は、対象バージョンの [GitHub Release](https://github.com/nekobato/nabecms/releases) に記載したデータ移行手順に従います。
