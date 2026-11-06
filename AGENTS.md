# NabeCMS

この `AGENTS.md` は、エージェント作業時の補足ルールと参照先のみを記載します。  
システム仕様の詳細（構成、API、運用、データ仕様など）は `docs/` を一次情報として参照してください。

## Docs First ポリシー

- `docs/` で説明できる内容は `AGENTS.md` に重複記載しない。
- `docs/` の英語版を既定とし、日本語版は `docs/ja/` に同じページ構成で配置する。
- 仕様変更時は、まず該当する `docs/` を更新し、必要な場合のみ `AGENTS.md` に参照リンクを追加する。
- 実装前後の確認は、以下の「参照マップ」を優先する。

## 参照マップ（`docs/`）

### 全体・初期セットアップ

- プロジェクト概要: `docs/index.md`
- クイックスタート: `docs/getting-started.md`
- 開発者向け構成: `docs/developer.md`

### アーキテクチャ・基盤

- 全体構成/リクエストフロー: `docs/architecture.md`
- Cloudflare 前提設計: `docs/cloudflare.md`

### API

- API 全体概要/共通規約: `docs/api/index.md`
- Admin API: `docs/api/admin.md`
- Contents API: `docs/api/contents.md`

### Admin UI・フィールド仕様

- Admin UI ガイド: `docs/admin/index.md`
- フィールド型/variant/options: `docs/admin/fields.md`

### データ運用・セキュリティ

- マイグレーション: `docs/data-management.md`
- デプロイ/運用: `docs/operations.md`
- アプリ設定: `docs/configuration.md`
- 認証メール: `docs/email.md`
- セキュリティ: `docs/security.md`
- 外部連携/用語/共通エラー: `docs/api/index.md`

## 実装時の補足（`AGENTS.md` 固有）

- DB の最終的な実装定義は `packages/nabecms-core/src/database/schema.ts` を参照する。
- API レスポンス型の共有定義は `packages/nabecms-core/src/contracts` と `packages/nabecms-core/src/rpc` を参照する。

## Frontend Coding Guide

### Styling

- Fontsize は `1rem = 14px`
  - サイズは変数で管理し、変数名から pixel 値が分かる形式にする（例: `--font-size-14: 1rem`）
- Colors は Element Plus 等の既定テーマを優先する
- Card 系コンテナの境界は影ではなく薄い線で表現する
  - `packages/nabecms-admin/src/assets/styles/main.css` の `--card-border` / `--card-border-hover` を優先する
  - Figma の elevation / shadow 指定は、overlay や focus ring を除き、基本的に border token へ変換する
- Spacing / Margin / Padding は 8-point / 4-point grid で定義する
  - 例: `--spacing-16: 1rem`

### Docs

- 機能の追加・変更時は、該当するドキュメントと README を英語版・日本語版ともに更新する
