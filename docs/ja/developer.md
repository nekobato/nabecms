# 開発者ガイド

NabeCMS 本体を変更するときは、リポジトリ内の開発用アプリで動作を確認します。
公開パッケージを使うアプリを作る場合は、[クイックスタート](./getting-started.md)を参照します。

## リポジトリ構成

| 場所 | 役割 |
| --- | --- |
| `packages/nabecms-core` | WorkerのAPI、認証、データ処理、共有型 |
| `packages/nabecms-admin` | 管理画面 |
| `packages/nabecms` | Workerとビルド済み管理画面をまとめた公開パッケージ |
| `packages/nabecms-cli` | 診断、migration、migration bundleの生成 |
| `packages/create-nabecms` | アプリを生成するstarter |
| `packages/dev` | 本体開発用のWorkerと管理画面の結合環境 |
| `examples/basic` | 公開パッケージを利用する参照用アプリ |
| `docs` | 利用者向けと開発者向けのドキュメント |

## 開発環境

API の動作や編集操作を変更するときは、Worker と管理画面を一緒に起動します。
リポジトリのルートで依存関係とローカル用の設定ファイルを用意します。

```bash
pnpm install --frozen-lockfile
cp packages/dev/.dev.vars.example packages/dev/.dev.vars
```

シークレットは[クイックスタート](./getting-started.md#ローカルのシークレットを設定する)と同じ手順で生成します。
`packages/dev/.dev.vars` の値を設定した後、DBを用意して起動します。

```bash
pnpm db:migrate:local
pnpm dev
```

Workerは `http://localhost:8787`、管理画面は `/admin/` です。
開発中はWorkerが管理画面のVite dev serverへ接続します。

## 参照用アプリ

`examples/basic` は、starterが生成するアプリの参照実装です。
workspace内ではパッケージをリンクするため、管理画面を先にビルドします。

```bash
pnpm build
cp examples/basic/.dev.vars.example examples/basic/.dev.vars
```

シークレットを設定してから、次を実行します。

```bash
pnpm -C examples/basic run nabecms:migrate --local
pnpm -C examples/basic run typecheck
pnpm -C examples/basic run dev
```

パッケージを導入する側から変更の影響を確かめるには、この参照用アプリを使います。
スクリプトは `pnpm -C examples/basic run <script>` の形で実行し、Cloudflare への配備は[運用とデプロイ](./operations.md)に従います。

## 検証

本体の変更は `pnpm verify` で一通り確認できます。
変更内容に応じて、ブラウザー操作、配布物、ドキュメントの検証を追加します。

| コマンド | 確認すること |
| --- | --- |
| `pnpm test` | Core、管理画面、CLI、starter、配布用ツールの回帰テスト |
| `pnpm verify` | ビルド、lint、format、型検査、回帰テスト、設定診断 |
| `pnpm admin:test:e2e` | 専用のローカルWorkerとブラウザによる管理画面の主要操作 |
| `pnpm package:smoke` | 5 tarballの構成と、repository外での生成、install、型検査、診断、migration、起動、初期設定、ログイン、deploy dry-run |
| `pnpm security:audit` | 本番依存の既知脆弱性 |
| `pnpm docs:build` | 文書と内部リンクのビルド |

`pnpm package:smoke` の前には `pnpm build` を実行します。
Browser smokeとPackage smokeの一時アプリやローカルDBは、終了時に削除されます。
Cloudflareへの実配備とnpm公開後の導入確認は、初回公開や環境変更に合わせて行います。

スキーマやマイグレーションを変更したときは、新規データベースと既存データの両方に適用できることを D1 の統合テストで確認します。

## starterの保守

`packages/create-nabecms/template/basic` と `examples/basic` は、設定、SQL、runtime migration bundleを共有する構成です。
`pnpm starter:test` が両者の対応を検査します。
本体開発用のmigrationと公開用のmigrationも、適用後のschemaをD1統合テストで比較します。

公開パッケージの入口と設定項目は[設定リファレンス](./configuration.md)、schema の拡張手順は[データ管理](./data-management.md#schema-の拡張)に記載しています。
