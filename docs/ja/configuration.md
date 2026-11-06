# `nabecms.config.ts` リファレンス

CMS の実行時の設定は `nabecms.config.ts` に記述します。
Cloudflare のバインディングと環境変数は Wrangler の設定で指定します。
標準テンプレートの[設定ファイル](https://github.com/nekobato/nabecms/blob/main/packages/create-nabecms/template/basic/nabecms.config.ts)は `defineConfig()` で設定を定義します。
[Worker の入口](https://github.com/nekobato/nabecms/blob/main/packages/create-nabecms/template/basic/src/worker.ts)で `createApp()` に渡すと設定を検証し、未定義の項目を拒否します。

## 設定項目 {#option}

### データベースのマイグレーション

本番では既定で配備時にマイグレーションを適用します。
手順は[データ管理](./data-management.md#マイグレーション)に記載しています。

| 設定 | 型 | 既定値 | 効果 |
| --- | --- | --- | --- |
| `database.migrations.enabled` | `boolean` | 本番は `false`、それ以外は `true` | リクエスト処理時にマイグレーションを実行する |
| `database.migrations.tableName` | `string` | `d1_migrations` | 適用履歴のテーブル名。有効な SQL 識別子を使う |
| `database.migrations.app` | `RuntimeMigration[]` | `[]` | アプリ独自のマイグレーションを宣言順に適用する |
| `database.migrations.app[].name` | `string` | なし | マイグレーションを識別する一意の空でない名前 |
| `database.migrations.app[].sql` | `string` | なし | 適用する空でない SQL |

### 管理画面の開発サーバー

開発中に管理画面を開発サーバーへつなぐ場合に設定します。
本番では Worker が[Assets バインディング](./cloudflare.md#固定の-route-と-binding)からビルド済みの管理画面を配信します。

| 設定 | 型 | 既定値 | 効果 |
| --- | --- | --- | --- |
| `admin.devServer.enabled` | `boolean` | `ADMIN_DEV_PROXY`、未指定なら `true` | `WORKER_ENV=development` のときにプロキシを有効にする |
| `admin.devServer.port` | 正の整数 | `ADMIN_DEV_PORT`、未指定なら `2525` | 開発サーバーの接続先ポート |
| `admin.devServer.host` | `string` | `127.0.0.1` | 開発サーバーの接続先ホスト |

### リクエストログ

| 設定 | 型 | 既定値 | 効果 |
| --- | --- | --- | --- |
| `observability.structuredLogs.enabled` | `boolean` | テスト時や環境の指定がない場合は `false`、それ以外は `true` | Admin API と Contents API の構造化リクエストログを `console.log` へ出力する |

ログの項目と調査の手順は[リクエストログと障害対応](./operations.md#リクエストログと障害対応)を参照します。

## インポート先 {#import-path}

| インポート先 | 用途 |
| --- | --- |
| `@nekobato/nabecms` | `createApp`、設定、Worker の公開型 |
| `@nekobato/nabecms/contracts` | クライアントと共有するフィールドと JSON の型 |
| `@nekobato/nabecms/rpc/admin` | Admin API の Hono RPC 型 |
| `@nekobato/nabecms/rpc/contents` | Contents API の Hono RPC 型 |

パッケージを参照するときは、表の公開パスを使います。

## 管理画面で変更する設定

[ログの保持期間](./admin/index.md#ログ管理)と[認証メール](./email.md)は Super Admin が管理画面から設定します。
