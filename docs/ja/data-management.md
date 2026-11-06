# データ管理

NabeCMS の環境を復元するために、D1 と対応する R2 のファイルをバックアップします。
別の CMS に記事を移す場合は、コンテンツを JSON でエクスポートし、参照するファイルをダウンロードします。
バージョン更新の手順は[運用とデプロイ](./operations.md#バージョン更新とデータベース)を参照します。

## 他CMSへの移行用エクスポート

Super Admin が「Settings → General」で「エクスポートを開く」を選ぶと、コンテンツとログを別々の JSON ファイルとして取得できます。
取得したデータの形式変換とインポートは移行先で行います。

### コンテンツファイル

`GET /api/admin/export/content` は `format: "nabecms-content-export"`、`version: 1`、`exportedAt`、件数を示す `counts` と次の配列を返します。

| キー | 内容 |
| --- | --- |
| `models` | モデル定義と `fields`。フィールドの型、設定、既定値、公開設定を含む |
| `locales` | ロケールコードと既定ロケール |
| `entries` | ID、状態、日時、`publishedFields`、`draftFields`、`archivedFields` |
| `media` | ファイルのメタデータと原本ごとの `downloadPath` |
| `warnings` | 現行スナップショットの欠落や、フィールド、ロケール、メディア、エントリーへの解決できない参照 |

公開済みのエントリーには公開中の内容が入り、未公開の編集がある場合は別に下書きが入ります。
未公開のエントリーには最新の下書き、アーカイブ済みのエントリーには最後のリビジョンの値が入ります。
それ以前のリビジョン、予約公開、プラグイン、webhook、認証情報、ユーザーとロール、アプリ独自のテーブルは対象外です。

項目を移行先に対応付けるには、`entries[].publishedFields[]` の `fieldId` を `models[].fields[].id` と照合し、`fieldKey` と型を特定します。
`valueRelation` はエントリー ID、`valueMedia` はメディア ID と照合します。
複数メディアの ID は `valueJson` に入ります。
参照先が見つからない場合は `warnings` を確認します。
リッチテキストや JSON に埋め込まれた URL と参照はそのまま出力されるため、移行時に別途確認します。

ファイル本体は `downloadPath` が示す認証付きの Admin API から個別にダウンロードします。
JSON のメタデータを出力する時点では、R2 に原本が残っているかどうかは確認しません。

### ログファイル

`GET /api/admin/export/logs` は `format: "nabecms-log-export"`、`version: 1`、`exportedAt`、種類別の `counts`、`auditLogs`、`authLoginEvents` を返します。
操作ログの `before` と `after` に含まれる項目は[ログ API](./api/admin.md#監査ログ-認証ログ)と同じです。
対象は保存済みのログで、リビジョン履歴、Workers Logs、保持期限によって削除されたログは含みません。

エクスポートはテーブルを順に読むため、同じ時点のデータを取得するには、処理中の編集とメディア操作を止めます。
完全なファイルを作れない場合、API は JSON エラーを返します。
上限は各テーブル 50,000 行、JSON は 25 MiB です。
上限を超える場合は D1 から直接抽出します。

## マイグレーション

アプリの SQL は `migrations/` に置き、適用前に内容を確認します。
`pnpm nabecms:doctor` では、バインディング、ローカル環境、マイグレーションディレクトリを確認できます。
`pnpm db:generate` と `pnpm nabecms:migrate` は、実行時に使う `src/database/runtime-migrations.generated.ts` も更新します。

まずローカルに適用し、その後は[本番の更新手順](./operations.md#バージョン更新とデータベース)に従います。
本番のリクエスト時マイグレーションは既定で無効です。
必要な場合は `nabecms.config.ts` に `database.migrations.enabled: true` を設定します。
実行には D1 の `batch()` に対応するバインディングが必要です。
マイグレーションと適用履歴は同時に確定するため、途中の SQL が失敗した場合は適用前の状態に戻ります。

## schema の拡張

CMS 本体がテーブルの定義と適用順を管理します。
アプリ固有のデータは `src/database/schema.ts` に独自テーブルを定義し、ID で CMS のデータと関連付けます。

### app 側 schema 拡張ルール

独自テーブルには `app_<name>` を使います。
インデックスには `app_<table>_<purpose>_idx`、一意インデックスには `app_<table>_<purpose>_unique` を使います。
CMS 本体のレコードは `entry_id` や `model_id` などで参照します。

### 運用フロー

`src/database/schema.ts` を更新した後、マイグレーションを生成し、設定を確認してローカルに適用します。

```bash
pnpm db:generate
pnpm nabecms:doctor
pnpm nabecms:migrate --local
```

変更を適用したデータベースでアプリの動作を確かめてから、本番にも同じマイグレーションを適用します。
標準テンプレートは配備時に適用します。
独自の配備では[バージョン更新とデータベース](./operations.md#バージョン更新とデータベース)を参照します。

## 破壊的変更の影響

モデルを削除すると、関連するエントリー、フィールド、リビジョンも削除されます。
フィールドを削除すると、そのフィールドの保存済みの値も削除されます。

型を変更する場合は、既存のエントリーに新しい型で扱えない値がないか確認します。
`fieldKey` を変更すると API のキーも変わるため、該当するキーを使うクライアントを更新します。
