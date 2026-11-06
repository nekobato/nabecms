# Cloudflare の前提と設定

生成したアプリは、一つの Worker から API と管理画面を提供します。
CMS のデータは D1、ファイルは非公開の R2 バケットに保存します。
Alpha.1 の実環境検証は Workers Paid で実施しました。
無料プランでの動作は未確認です。
配備の順序は[運用とデプロイ](./operations.md#初回デプロイ)を参照します。

## 利用する機能

配備する環境ごとに D1 データベースと R2 バケットを用意します。
Worker は Workers Assets から管理画面を配信し、Workers Rate Limiting で認証の試行回数を制限します。
派生画像を生成する場合は Cloudflare の画像変換（`cf.image`）を使います。
編集者は[メディアのアップロード時](./admin/index.md#メディア管理)に派生画像の種類を選べます。
[ローカルで試す](./getting-started.md)ときは Wrangler が D1 と R2 をエミュレーションします。

## 固定の route と binding

バインディング名は標準テンプレートの値を使い、リソースの名前と ID を配備先に合わせます。

| 設定 | 値 |
| --- | --- |
| Worker の互換性フラグ | `nodejs_compat` |
| 管理画面のルート | `/admin` |
| D1 バインディング | `DB` |
| 非公開 R2 バインディング | `R2` |
| Workers Assets バインディング | `ASSETS` |
| `assets.directory` | `./node_modules/@nekobato/nabecms/admin/dist` |
| `assets.not_found_handling` | `single-page-application` |
| `assets.run_worker_first` | `true` |
| ログイン用 Rate Limiting バインディング | `AUTH_LOGIN_RATE_LIMITER`、10 回 / 60 秒 |
| その他の認証用 Rate Limiting バインディング | `AUTH_SENSITIVE_RATE_LIMITER`、5 回 / 60 秒 |

Worker が API と `robots.txt` を先に処理し、SPA のフォールバックによって `/admin/models/create` などの URL も直接開けるようにします。
[メディアの公開条件](./security.md#メディア公開)は Worker で適用するため、R2 バケットは非公開にします。

本番環境では二つの Rate Limiting バインディングが必要です。
名前付き環境に `ratelimits` は継承されないため、`env.production` にも指定します。
二つの `namespace_id` には、Cloudflare アカウント内で重複しない別々の正の整数文字列を使います。
`pnpm nabecms:doctor` でバインディング名、上限、名前空間の ID を確認できます。
認証操作に対する制限は[レート制限](./security.md#レート制限)を参照します。

## 環境変数と Secrets

| 名前 | 用途 | 保存先 |
| --- | --- | --- |
| `WORKER_ENV` | `development` / `production` の動作切り替え | Wrangler の `vars` |
| `BOOTSTRAP_SECRET` | 初期管理者の作成に必須 | ローカルは `.dev.vars`、本番は Cloudflare Secrets |
| `JWT_SECRET` | 本番で必須。管理 API のトークン署名などに使用 | ローカルは `.dev.vars`、本番は Cloudflare Secrets |
| `BETTER_AUTH_URL` | Better Auth の公開オリジン | Wrangler の `vars` |
| `BETTER_AUTH_SECRET` | Better Auth のセッション保護 | ローカルは `.dev.vars`、本番は Cloudflare Secrets |
| `ADMIN_DEV_PROXY` / `ADMIN_DEV_PORT` | 開発時の管理画面の開発サーバー接続先 | ローカル開発環境 |

標準テンプレートでは `BETTER_AUTH_URL` と `BETTER_AUTH_SECRET` を両方設定します。
Better Auth のセッションを使う場合は二つをそろえ、URL には利用者が開くオリジンを指定します。
本番環境の URL は HTTPS にします。
値の保管は[シークレット管理](./security.md#シークレット管理)、メールを送信する場合の環境設定は[認証メール](./email.md)を参照します。

## D1 の制約

Cloudflare は Worker の一回の呼び出しで実行できる D1 クエリの数を、プランごとに制限しています。
一括公開では選択したエントリーとリビジョンを個別に読み取るため、選択件数によってはプランの上限に達します。
具体的な上限は[Cloudflare の D1 制限](https://developers.cloudflare.com/d1/platform/limits/)で確認できます。

NabeCMS は一括公開に対して独自のステートメント数の上限も設けています。
API の上限と、上限に達したときの対処は[Admin API のエントリー](./api/admin.md#エントリー)を参照します。
