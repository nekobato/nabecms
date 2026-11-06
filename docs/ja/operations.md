# 運用とデプロイ

[クイックスタート](./getting-started.md)で作成したアプリを、本番用の D1 データベースと R2 バケットを使って配備します。
コマンドはアプリのディレクトリで実行します。
リソースを作る前に[Cloudflare の前提と設定](./cloudflare.md)で配備条件を確認します。

## 初回デプロイ

### リソースを作成する

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create my-cms-production
pnpm exec wrangler r2 bucket create my-cms-media
```

作成結果に合わせて、`wrangler.jsonc` の `database_name`、`database_id`、`bucket_name` を更新します。
Worker 名をアプリに合わせ、トップレベルと `env.production` の両方でリソースの指定を確認します。
ファイルの配信を Worker 経由にするため、R2 バケットは非公開にします。

`env.production.ratelimits` には、[バインディングの設定](./cloudflare.md#固定の-route-と-binding)に従って未使用の名前空間 ID を指定します。
`BETTER_AUTH_URL` は、利用者がログインする本番環境の HTTPS オリジンに変更します。

### Secrets を登録する

本番用に異なるランダム値を三つ生成します。
それぞれの用途は[環境変数と Secrets](./cloudflare.md#環境変数と-secrets)で確認できます。
値はコマンドの入力欄から登録し、設定ファイルや Git 履歴には保存しません。

```bash
pnpm exec wrangler secret put BOOTSTRAP_SECRET --env production
pnpm exec wrangler secret put JWT_SECRET --env production
pnpm exec wrangler secret put BETTER_AUTH_SECRET --env production
```

### 診断してデプロイする

```bash
pnpm nabecms:doctor
pnpm typecheck
pnpm deploy
```

標準テンプレートの `deploy` は、本番 D1 にマイグレーションを適用してから Worker を配備します。
`nabecms:doctor` はローカルの設定を確認します。
配備後は本番 URL の `/admin` を開き、本番用の `BOOTSTRAP_SECRET` で最初の管理者を作成します。
新しい D1 にはローカル環境のアカウントや記事は入りません。

本番環境でログインし、確認用のエントリーを公開します。
ファイルを一つアップロードして開くところまで試すと、セッション、D1、R2 が配備先で動くことを確認できます。

## バージョン更新とデータベース

アップグレードの前に、対象バージョンの [GitHub Release](https://github.com/nekobato/nabecms/releases) で互換性と移行手順を確認します。
D1 と R2 をバックアップしてからパッケージを更新し、ローカルでマイグレーションとアプリの動作を確認します。

本番ではリクエスト時のマイグレーションが既定で無効です。
独自の配備手順を使う場合は、Worker を更新する前に次のコマンドを実行します。

```bash
pnpm nabecms:migrate --remote --env production
```

マイグレーションファイルと独自テーブルの扱いは[データ管理](./data-management.md#マイグレーション)を参照します。

## メディアの運用

ファイルは[公開条件](./security.md#メディア公開)を確認する Worker から配信します。
メディアを削除すると、Worker は最初にデータベースのレコードを削除します。
`204 No Content` はこの処理の完了を示します。
その後にレコードを確認するリクエストには `404` を返します。
削除前に確認を終えたリクエストは完了することがあり、利用者が取得済みのファイルは残ります。

データベースの処理後、Worker は R2 上の原本と派生画像を削除します。
失敗した場合はメディア ID とオブジェクトのキーをログに記録し、残りのキーを処理します。
処理が中断した場合や画像変換と重なった場合は、ログに現れないオブジェクトが残ることがあります。
削除済みの ID にもう一度 DELETE を送ると `404` になります。

残存オブジェクトを回収する場合は、正確なキーを特定します。
現行の原本や派生画像のレコードがそのキーを参照していないことと、キーへの書き込みが完了したことを確認してから、R2 上のオブジェクトを個別に削除します。

## キャッシュ

Contents API とメディアのルートは `Cache-Control: private, no-store` を返します。
共有キャッシュに保存すると、異なる API キーに対して同じ応答を返したり、非公開に切り替えた後も配信したりする可能性があります。
CDN や共有プロキシでは応答を保存せず、`ETag` と `Last-Modified` は応答の確認に使います。

## リクエストログと障害対応

リクエストを調査するには、応答ヘッダーの `X-NABECMS-Request-Id` を Cloudflare Workers Logs で検索します。
本番の Admin API と Contents API のリクエストは `event: "nabecms.api_request"` で識別できます。
ログには `requestId`、`scope`、`routeGroup`、`status`、`durationMs` があり、Contents API では取得できた `modelId` と `apiKeyId` も記録します。
認証情報、本文、クエリ文字列、IP アドレス、メールアドレスは記録しません。

[構造化ログの設定](./configuration.md#option)で通常のリクエストログを切り替えます。
認証レート制限の超過とバインディング障害は、この設定にかかわらず `event: "nabecms.auth_rate_limit"` として記録します。

| 症状 | 確認する内容 |
| --- | --- |
| `401` / `403` | セッション、API キーの権限と `allowedModels` |
| `500` | D1 バインディング、DB 接続、マイグレーションの適用状況 |
| 認証操作の `429` | `Retry-After` とレート制限ログ |
| `503 AUTH_RATE_LIMIT_UNAVAILABLE` | 本番の `ratelimits`、名前空間 ID、バインディングの状態 |
| メディアの `404` | D1 のメディアレコード、R2 のオブジェクトキー、`R2` バインディング |

## ログの定期削除

標準テンプレートでは毎日 18:00 UTC（日本時間の翌日 03:00）に期限切れのログを削除します。
保持期間は Super Admin が管理画面の[ログ管理](./admin/index.md#ログ管理)で変更できます。
定期処理は既存の D1 スキーマを使うため、初回の実行前にマイグレーションを適用します。

独自の Worker では HTTP ハンドラーを維持し、定期実行用のハンドラーから `runLogCleanup(env)` を呼び出します。

```ts
import { createApp, runLogCleanup, type Env } from "@nekobato/nabecms";
import config from "../nabecms.config";

const app = createApp({ config });
export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runLogCleanup(env);
  },
};
```

配備する環境に `"triggers": { "crons": ["0 18 * * *"] }` を設定します。
名前付き環境を使う場合は `env.production` にも設定し、既存の Cron 設定と統合します。

一回の実行で各ログテーブルから最大 2,500 件を 500 件ずつ削除します。
約 20 秒を超えると次の処理を始めず、残りは次回に持ち越します。
管理画面に期限切れログの残存表示が続くときは、実行間隔を変更する前に最後の実行結果を確認します。

失敗時は Cron、マイグレーションの適用状況、Workers Logs を確認します。
`LOG_RETENTION_SETTINGS_ERROR` は保持期間の読み取りか検証の失敗、`LOG_CLEANUP_DATABASE_ERROR` は D1 の処理の失敗を示します。
D1 の障害で終了状態が記録されなかった場合は、最後の開始時刻と Workers Logs を照合します。
原因を解消すると、次回の定期実行で削除を試みます。

次の定期実行を待たずに削除するには、同じ D1 バインディングを持つ信頼された Worker のコードから `runLogCleanup(env)` を呼び出します。
一時停止するには保持期間を無期限にするか、該当する Cron を外します。
実行中の処理は開始時点の設定を使います。
削除したログを復元するにはバックアップが必要です。
