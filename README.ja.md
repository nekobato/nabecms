[![CI](https://github.com/nekobato/nabecms/actions/workflows/ci.yml/badge.svg)](https://github.com/nekobato/nabecms/actions/workflows/ci.yml)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/public/logo-dark.svg" />
    <img src="./docs/public/logo.svg" alt="NabeCMS logo" width="96" height="96" />
  </picture>
</p>

# NabeCMS

[English](./README.md)

NabeCMS は、Cloudflare Workers で動くヘッドレス CMS です。
管理画面でコンテンツモデルを定義し、編集した記事を API から配信できます。
管理画面と API は一つの Worker にデプロイします。
データは D1 に、画像などのファイルは非公開の R2 バケットに保存します。

## 主な機能

- 型付きフィールドと多言語コンテンツの管理
- 下書き、公開、リビジョンの復元
- 関連エントリーをたどりながらの編集
- メディアのアップロードと、公開状態に応じた配信
- ロールによる管理権限とAPI Keyによる配信権限の制御
- 操作ログの検索、保持期間の設定、任意の認証メール

管理画面での操作は[管理画面ガイド](./docs/ja/admin/index.md)、API の利用条件とリクエスト形式は[API概要](./docs/ja/api/index.md)に記載しています。

## 導入

```bash
npm create nabecms@next my-cms
```

`next` は最新の Alpha 版を指します。
導入に必要な環境、シークレットの設定、起動手順は[クイックスタート](./docs/ja/getting-started.md)に記載しています。

Alpha 期間は API や設定に互換性のない変更が入る可能性があります。
アップグレード時は、対象バージョンの[GitHub Release](https://github.com/nekobato/nabecms/releases)に記載した移行手順に従います。
Alpha.1 の実環境検証は Workers Paid を対象としています。

## ドキュメント

| 目的 | 参照先 |
| --- | --- |
| 初めて導入する | [クイックスタート](./docs/ja/getting-started.md) |
| Cloudflareへデプロイする | [運用とデプロイ](./docs/ja/operations.md) |
| 設定を変更する | [設定リファレンス](./docs/ja/configuration.md) |
| データを移行する | [データ管理](./docs/ja/data-management.md) |
| 認証と公開範囲を確認する | [セキュリティ](./docs/ja/security.md) |
| 招待メールと再設定メールを使う | [認証メール](./docs/ja/email.md) |
| 本体の開発に参加する | [開発者ガイド](./docs/ja/developer.md) |
| 内部構成を調べる | [アーキテクチャ](./docs/ja/architecture.md) |

## ライセンス

[ISC](./LICENSE)
