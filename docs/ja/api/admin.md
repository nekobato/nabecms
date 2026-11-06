# Admin API

管理画面でログインした利用者が行える操作を、Admin API から自動化できます。
実行する操作の権限を確認し、エントリーを書き込むときは再試行の規則も参照します。

## 認証モデル

メールアドレスとパスワードでログインし、得られたトークンを `Authorization: Bearer <access_token>` で送信します。
すでに Better Auth のセッション Cookie がある場合は、`GET /api/auth/get-session` で確認し、`POST /api/admin/auth/session-token` で一時的な管理 API トークンを取得します。
Better Auth の利用には `BETTER_AUTH_SECRET` と `BETTER_AUTH_URL` の両方が必要です。
値の扱いは[シークレット管理](../security.md#シークレット管理)、ログイン用のルートは[ローカル認証 API](#ローカル認証-api)を参照します。

HTML フォームから送信できる `/api/admin/auth/*` の変更リクエストでは、`Origin` と `Sec-Fetch-Site` を送る場合に同じオリジンを示す必要があります。
別のオリジンからの操作には `403` を返します。
CLI は二つのヘッダーを省略できます。

## 認可モデル

管理操作は明示的な許可がある場合に実行できます。
`system.super-admin` はすべての管理操作を行えます。
ほかのロールでは `permissions.allow` を組み合わせ、`users:*:write` などのワイルドカードを、ルートが要求する権限と照合します。
エントリーの権限は `entries:<modelId>:read` のようにモデルを含みます。
管理画面で設定した `entries:*:<action>` は全モデルに適用します。

いずれかの権限を求める操作では一つがあれば実行できます。
二つの検査がある場合は両方が必要です。
たとえば公開状態でエントリーを作るには、作成と公開の両方の権限が必要です。

### Route の認可区分

| 区分 | 条件 |
| --- | --- |
| [初期化と認証](#初期化と認証) | 操作に応じてシークレット、認証情報、Cookie を検証する |
| [招待](#招待-invites) | 受諾時はトークンを検証し、発行や一覧取得は招待権限を要求する |
| `GET /api/admin/auth/me` と自分の設定 | 有効な管理 API トークン |
| 管理対象のリソース | 有効な管理 API トークンと操作に必要な権限 |
| メディアの原本と派生版 | 公開済みファイルは認証なしで取得できる。それ以外は認証と `media:*:read` または `media:*:write` が必要 |

### Endpoint permission matrix

`read | write` はどちらか一方、`A + B` は両方の権限を示します。
`<modelId>` は URL パラメーターの値です。

| Resource / endpoint                                                                             | 必須 permission                                                                          |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/admin/models`、`GET /api/admin/models/:modelId`、`GET .../dependencies`               | `models:*:read` \| `models:*:write`                                                      |
| `POST /api/admin/models`、`PUT /api/admin/models/:modelId`、`DELETE /api/admin/models/:modelId` | `models:*:write`                                                                         |
| `GET /api/admin/models/:modelId/fields`                                                         | `models:*:read` \| `models:*:write`                                                      |
| field の `POST` / `PUT` / `PATCH order` / `DELETE`                                              | `models:*:write`                                                                         |
| entry の一覧、sheet、詳細、revision 一覧 | `entries:<modelId>:read` |
| entry 作成                                                                                      | `entries:<modelId>:create`。Published / Archived はさらに `entries:<modelId>:publish`    |
| entry 更新                                                                                      | `entries:<modelId>:update`。Published / Archived はさらに `entries:<modelId>:publish`    |
| entry の publish / unpublish                                                                    | `entries:<modelId>:publish`                                                              |
| revision restore                                                                                | `entries:<modelId>:update`                                                               |
| entry 削除                                                                                      | `entries:<modelId>:delete`。`detachReferences=true` はさらに `entries:*:update`          |
| entry bulk                                                                                      | publish / unpublish は `entries:<modelId>:publish`、delete は `entries:<modelId>:delete` |
| `GET /api/admin/entry-references`、`GET /api/admin/entry-reverse-references`                    | `entries:*:read`                                                                         |
| media metadata / variant の GET                                                                 | `media:*:read` \| `media:*:write`                                                        |
| media upload / update / delete / variant retry / transform                                      | `media:*:write`                                                                          |
| `GET /api/admin/media-references`                                                               | `media:*:read` \| `media:*:write`                                                        |
| locale GET                                                                                      | `locales:*:read` \| `locales:*:write`                                                    |
| locale POST / PATCH / DELETE                                                                    | `locales:*:write`                                                                        |
| role GET                                                                                        | `roles:*:read` \| `roles:*:write`                                                        |
| role POST / PUT / DELETE                                                                        | `roles:*:write`                                                                          |
| user GET                                                                                        | `users:*:read` \| `users:*:write`                                                        |
| user POST / PUT                                                                                 | `users:*:write`                                                                          |
| user DELETE                                                                                     | `users:*:delete` \| `users:*:write`                                                      |
| invite POST / GET / role-options / regenerate                                                    | `users:invite:write` \| `users:*:write`                                                  |
| API Key GET                                                                                     | `api_keys:*:read` \| `api_keys:*:write`                                                  |
| API Key POST / PUT / rotate / revoke / DELETE                                                   | `api_keys:*:write`                                                                       |
| media settings GET                                                                              | `settings:media:read` \| `settings:media:write`                                          |
| media settings PUT                                                                              | `settings:media:write`                                                                   |
| `GET /api/admin/logs`、`GET /api/admin/logs/auth`、`GET /api/admin/dashboard`                   | `logs:*:read`                                                                            |
| `GET /api/admin/export/content`、`GET /api/admin/export/logs`                                   | `system.super-admin` role のみ                                                           |

システムロールの割り当てには `system.super-admin` が必要です。
アカウントの変更とロールの制約は[ユーザー](#ユーザー)と[招待](#招待-invites)を参照します。

## Entry write の再試行と idempotency

一つの操作につき一つの `Idempotency-Key` を作ります。
エントリーの作成、更新、公開、非公開化、リビジョンの復元、削除と、一括操作の `action=publish` に必要です。
キーは 8〜255 文字で、ASCII の英数字と `-`、`_`、`.`、`:` を使います。
管理画面は操作ごとに UUID を作成します。

応答を受け取れなかった場合は、同じ利用者として、同じメソッド、リソース、クエリ、本文、キーを送信します。
24 時間以内であれば、API は初回のステータスと本文を `Idempotency-Replayed: true` とともに返します。
照合に使う記録には生のキーと本文を保存しません。
書き込みが失敗すると照合用の記録も確定しないため、同じキーで再試行できます。
24 時間経過後は新しい操作として受け付けることがあります。

| 応答 | 対処 |
| --- | --- |
| `400 IDEMPOTENCY_KEY_REQUIRED` | キーを送信する |
| `400 INVALID_IDEMPOTENCY_KEY` | 形式を修正する |
| `409 IDEMPOTENCY_KEY_REUSED` | 同じキーで送る場合は元のリクエストを再送し、別の操作には新しいキーを使う |

一括の非公開化と削除はエントリーごとの結果を返し、一部だけ成功する場合があります。
再試行前に結果を確認します。
[Workers Logs](../operations.md#リクエストログと障害対応)でリクエストを探すには `X-NABECMS-Request-Id` を使います。
初期化、招待受諾、パスワード再設定には別の一回限りの検査があり、認証情報やセッショントークンは再送用に保存しません。

## 初期化と認証

- `GET /api/admin/system/bootstrap`
  - 初期化済みかどうか、`allowInitialize` を返します。
- `POST /api/admin/auth/initialize`
  - `X-Nabecms-Bootstrap-Secret` header に `BOOTSTRAP_SECRET` を指定し、初回管理者を `system.super-admin` ロールで作成します（初期化済みの場合は 409）。
  - sentinel、system role、user、role assignment、credential account、default locale は単一 D1 batch で作成されます。
- `POST /api/admin/auth/session-token`
  - Better Auth セッション Cookie から管理 API 用 `accessToken` を発行します。

## Better Auth ローカル session endpoint

- `GET /api/auth/get-session`
- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-out`

これ以外の `/api/auth/*` は `404` を返します。

## ローカル認証 API

- `POST /api/admin/auth/login`
- `POST /api/admin/auth/logout`
- `POST /api/admin/auth/refresh`
- `GET /api/admin/auth/me`

## 招待（Invites）

`users:invite:write` または `users:*:write` があれば、招待の作成、一覧取得、再発行と、招待で付与できる通常ロールの確認ができます。

| エンドポイント | 操作 |
| --- | --- |
| `POST /api/admin/auth/invites`、`GET /api/admin/auth/invites` | 招待の作成、一覧取得 |
| `GET /api/admin/auth/invites/role-options` | 招待できるロールの `id`、`name`、`description`、`isSystem` を取得 |
| `POST /api/admin/auth/invites/:inviteId/regenerate` | リンクを再生成し、旧リンクを失効 |
| `POST /api/admin/auth/accept-invite/validate` | 受諾画面を開く前にリンクを検証 |
| `POST /api/admin/auth/accept-invite` | トークンを使ってアカウントを作成 |

`system.super-admin` などのシステムロールは、発行済みの招待でも付与できません。
作成、再生成、再送、検証、受諾でシステムロールを指定すると `403 FORBIDDEN` を返し、招待の内容は維持します。
既存のメールアドレスへの招待は `409 USER_ALREADY_EXISTS_FOR_INVITE` を返します。

受諾ではトークン、`pending` または `sent` の状態、有効期限をアカウント作成時に検証します。
事前検証後にリンクが無効になった場合や付与できないロールに変わった場合は `410 GONE` を返し、アカウントやセッションは作成しません。
送信と再生成の手順は[認証メール](../email.md#招待を送る)を参照します。

## モデル

- `GET /api/admin/models`
- `POST /api/admin/models`
- `GET /api/admin/models/:modelId`
- `PUT /api/admin/models/:modelId`
- `DELETE /api/admin/models/:modelId`
- `GET /api/admin/models/:modelId/dependencies`

## フィールド

- `GET /api/admin/models/:modelId/fields`
- `POST /api/admin/models/:modelId/fields`
- `PUT /api/admin/models/:modelId/fields/:fieldId`
- `DELETE /api/admin/models/:modelId/fields/:fieldId`
- `PATCH /api/admin/models/:modelId/fields/order`

指定できる値と保存時の検証は[フィールド定義](../admin/fields.md)を参照します。

## エントリー

エントリーの基点は `/api/admin/models/:modelId/entries` です。
表のパスはこの基点からの相対パスです。

| メソッドとパス | 操作 |
| --- | --- |
| 基点への `GET` または `POST` | 一覧取得、作成 |
| `GET /sheet` | Sheet View の行を取得 |
| `GET /:entryId`、`PUT /:entryId`、`DELETE /:entryId` | 一件の取得、更新、削除 |
| `POST /:entryId/publish`、`POST /:entryId/unpublish` | 公開状態を変更 |
| `GET /:entryId/revisions` | 保存したリビジョンの一覧取得 |
| `POST /:entryId/revisions/:revisionId/restore` | リビジョンを新しい下書きに復元 |
| `POST /bulk` | 選択したエントリーを一括操作 |

`GET /sheet` では `mode=draft|published` と `sortOrder=asc|desc` を選べます。
`sortBy=displayTitle|status|updatedAt|updatedBy|field:<fieldId>` は並べ替えのキー、`q=<keyword>` は表示タイトルと ID の部分一致検索です。
ロケールの優先順は `locale=<localeCode>` で指定し、値がなければ既定ロケールを使います。

復元で作成した下書きは、次に公開するまで公開中の内容を変更しません。
`fields` を省略して公開状態に更新すると、保存済みのリビジョンの値で公開します。

リレーションやリッチテキストから参照されているエントリーの削除には `409 ENTRY_REFERENCED` を返します。
必要な権限を持つ利用者が `?detachReferences=true` を付けると、現在の公開フィールドと下書きから参照を外して削除します。

一括操作の `entryIds` は 1〜50 件です。
`action=publish` は全件をまとめて確定し、[再試行用のキー](#entry-write-の再試行と-idempotency)を要求します。
読み取りと書き込みの見積もり、または書き込みのステートメント数が 800 を超えると、書き込み前に `400 ENTRY_QUERY_BUDGET_EXCEEDED` を返します。
`error.estimatedQueries` と `error.maxQueries` を確認して件数を分けます。
[Cloudflare の D1 制約](../cloudflare.md#d1-の制約)は別に適用されます。

値がフィールドの定義に合わない場合は `400 FIELD_VALIDATION_FAILED` を返します。
応答は `{ error: { code, message, fieldId, reason } }` です。
必須値がない場合、`reason` は `required field is empty` または `required field is empty for locale '<locale>'` になります。
値の形式と保存済みリビジョンの再検査は[フィールド定義](../admin/fields.md)を参照します。

## メディア

| エンドポイント | 操作 |
| --- | --- |
| `GET /api/admin/media` | `type` と `search` で絞り込む。`limit` と `offset` でページを指定し、`items` と絞り込み後の `total` を取得 |
| `POST /api/admin/media` | 原本一件をアップロード。[アップロード要件](#運用メモ)を参照 |
| `GET /api/admin/media/:mediaId`、`PUT /api/admin/media/:mediaId` | メタデータの取得と更新 |
| `DELETE /api/admin/media/:mediaId` | CMS のレコードを削除し、原本と派生版の R2 からの削除を試みる |
| `GET /api/admin/media/:mediaId/file` | 原本の取得 |

`204` は CMS 上の削除完了を示します。
存在しない ID や削除済みの ID は `404` を返します。
R2 の残存ファイルを扱う前に[メディアの運用](../operations.md#メディアの運用)を参照します。

### メディア変換（Variants）

- `GET /api/admin/media/:mediaId/variants`
- `POST /api/admin/media/:mediaId/variants/transform`
- `POST /api/admin/media/:mediaId/variants/retry`
- `GET /api/admin/media-variants`
- `GET /api/admin/media-variants/:variantId/file`

### メディア設定

派生画像のテンプレートは `GET /api/admin/settings/media` と `PUT /api/admin/settings/media` で取得、変更できます。
`fit` と `upscale` の効果は[メディア管理](../admin/index.md#メディア管理)を参照します。

## ロケール

- `GET /api/admin/locales`
- `POST /api/admin/locales`
- `PATCH /api/admin/locales/:code`
- `DELETE /api/admin/locales/:code`

## ロール

- `GET /api/admin/roles`
- `POST /api/admin/roles`
- `PUT /api/admin/roles/:roleId`
- `DELETE /api/admin/roles/:roleId`

## ユーザー

一覧取得と作成には `GET /api/admin/users` と `POST /api/admin/users`、既存ユーザーの更新と削除には `PUT /api/admin/users/:userId` と `DELETE /api/admin/users/:userId` を使います。

Super Admin の変更には、操作する利用者にも `system.super-admin` が必要です。
`users:*:write` だけでは `403` を返します。
`email` を変更できるのは本人だけです。
他人のアドレスを変更するリクエストには `403 FORBIDDEN` を返し、同時に送信した変更も適用しません。
同じアドレスの再送は受け付けます。

`roleIds` を指定して保存するか、自分のメールアドレスを変更すると、更新と同時に対象のセッションが失効します。
`password` は空文字や `null` でも送信すると `400 BAD_REQUEST` を返します。
パスワードの変更は本人が[認証メールの再設定](#認証メール)から行います。

## ユーザー設定（自分用）

- `GET /api/admin/user-preferences`
- `PUT /api/admin/user-preferences`

## API Keys

- `GET /api/admin/api-keys`
- `POST /api/admin/api-keys`
- `GET /api/admin/api-keys/:id`
- `PUT /api/admin/api-keys/:id`
- `POST /api/admin/api-keys/:id/rotate`
- `POST /api/admin/api-keys/:id/revoke`
- `DELETE /api/admin/api-keys/:id`

## 監査ログ / 認証ログ

どちらのルートも `logs:*:read` を要求します。
保存するデータの範囲は[監査ログ](../security.md#監査ログ)を参照します。

`GET /api/admin/logs` は操作とリビジョンのメタデータを返します。
`action`、完全一致の `targetId`、`dateFrom`、`dateTo` は操作ログの一覧と件数に適用し、リビジョンの結果には適用しません。
ページ送りには `auditLimit`、`auditOffset`、`revisionLimit`、`revisionOffset` を使います。
応答には実行者名、日時、変更前後の状態やリビジョン ID が含まれます。
エントリーの本文を読むにはエントリーの閲覧権限が必要です。

`GET /api/admin/logs/auth` はローカルログインと招待の受諾結果を返します。
`result`、`reason`、`userId`、`dateFrom`、`dateTo` で絞り込み、`limit` と `offset` でページを指定します。
利用者の検索には `userId` を使います。
返却項目は[ログの型定義](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/contracts/logs.ts)を参照します。

期間の始まりと終わりはどちらも検索範囲に含まれます。
日時はタイムゾーン付きの ISO 8601 を使います。
日付だけの場合は UTC の 00:00:00、従来の `YYYY-MM-DD HH:mm:ss` も UTC として扱います。
不正な日時や終了が開始より前の期間には `400 INVALID_LOG_DATE_RANGE` を返します。

## ダッシュボード

- `GET /api/admin/dashboard`
  - `recentEntries[].displayTitle` は、モデルの `titleFieldId` に設定されたフィールド値を優先します。
    下書きリビジョンがある場合は下書き値を優先し、未設定または空の場合はエントリー ID にフォールバックします。
  - `recentEntries[].updatedByName` は更新者の `users.name` です。
    `updatedBy` には更新者の user ID を保持します。

## 参照解決

- `GET /api/admin/entry-references`
- `GET /api/admin/entry-reverse-references`
  - 対象 entry を参照している relation field と rich text embed を返します。
    現在の公開フィールドと current draft revision が対象です。
- `GET /api/admin/media-references`

## レスポンスの特徴

操作が失敗した場合は、応答の `error.code` と `error.message` を確認します。
エラーごとの対処は[共通エラー](./index.md#共通エラー)を参照します。
削除は `204 No Content` を返す場合があります。

## 認証と招待のエラーコード（抜粋）

| code                             | HTTP | 代表的な意味                                    |
| -------------------------------- | ---: | ----------------------------------------------- |
| `INITIAL_SETUP_REQUIRED`         |  403 | 初期管理者の作成が必要                          |
| `INVALID_BOOTSTRAP_SECRET`       |  403 | bootstrap secret が一致しない                   |
| `ALREADY_INITIALIZED`            |  409 | 初期化済み環境で initialize を実行した          |
| `UNAUTHORIZED`                   |  401 | credential、session、refresh token が無効       |
| `AUTH_SESSION_DISABLED`          |  404 | optional Better Auth session が設定されていない |
| `AUTH_CONFIGURATION_ERROR`       |  500 | Better Auth session の environment 設定が不完全 |
| `USER_ALREADY_EXISTS_FOR_INVITE` |  409 | 既存 user には invite を作成できない            |

## アップロード要件 {#運用メモ}

アップロードは一つのリクエストにつき一つの原本を multipart で送信し、上限は 50 MiB です。
JPEG、PNG、GIF、PDF、MP4、WebM、MOV、MP3、WAV、M4A に対応します。
MIME タイプとファイルのシグネチャを検証し、HTML や SVG など対応外の形式は拒否します。

| ステータス | コード |
| --- | --- |
| `400` | `INVALID_FILE_COUNT` |
| `413` | `FILE_TOO_LARGE` または `REQUEST_TOO_LARGE` |
| `415` | `UNSUPPORTED_MEDIA_TYPE` または `MEDIA_TYPE_MISMATCH` |

## ログの保持設定と削除状態

Super Admin は `GET /api/admin/settings/logs` で保持設定と直近の削除状態を取得できます。
応答は `Cache-Control: no-store` で、`item.retentionDays`、`cleanup`、`health` を返します。
初回の実行前は `cleanup` が `null` です。

変更するには `PUT /api/admin/settings/logs` へ `{ "retentionDays": 90 }` を送信します。
無期限にする場合は `{ "retentionDays": false }`、日数は 1〜730000 の整数を指定します。
応答は `{ item: { retentionDays } }` です。
設定は次回の定期実行から適用します。
実行の手順は[ログの定期削除](../operations.md#ログの定期削除)を参照します。

取得に失敗すると `503 LOG_MANAGEMENT_UNAVAILABLE`、保存に失敗すると `503 LOG_RETENTION_SAVE_FAILED` を返します。
保存時に通信が切れた場合は、設定を再取得するか、同じ値で再送します。
状態の項目は[ログ管理の型定義](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/contracts/log-management.ts)を参照します。
`cleanup.remaining: true` なら、状態が `completed` でも期限切れログが残っています。
`null` は残存の有無を確認していない状態です。

## 認証メール

[送信環境](../email.md)の設定後、Super Admin が以下のルートを使います。

| エンドポイント | 操作 |
| --- | --- |
| `GET /api/admin/settings/email` | 保存済みの設定、環境の状態、直近の送信結果を取得 |
| `PUT /api/admin/settings/email` | `senderName`、`invitesEnabled`、`passwordResetEnabled` を設定 |
| `POST /api/admin/settings/email/test` | 操作中の Super Admin 本人へテストメールを送信 |

公開ルートの `GET /api/admin/auth/email-capabilities` は利用できる機能を真偽値で返します。
招待の作成時に `sendEmail: true` を指定するとメールを送信します。
招待作成後にメール送信が失敗しても、`201` とトークン、送信結果を返します。
同じリンクを再送するには、招待管理権限を持つ利用者が `POST /api/admin/auth/invites/:inviteId/send` を実行します。
招待できないロールには `403`、無効な招待やリンクの再生成が必要な場合は `409`、配信に失敗した場合は `502` を返します。

パスワードの再設定を要求するには `POST /api/admin/auth/request-password-reset` へ `{ email }` を送信します。
受け付けたリクエストの応答は、アカウントの有無やメールの送信結果で変わりません。
メールに届いたトークンと新しいパスワードは `{ token, newPassword }` として `POST /api/admin/auth/reset-password` へ送信します。
期限とセッションの扱いは[パスワードを再設定する](../email.md#パスワードを再設定する)を参照します。
