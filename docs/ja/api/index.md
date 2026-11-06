# API 概要

外部サイトへのコンテンツ配信には Contents API、管理画面や管理ツールの実装には Admin API を使います。

| API | Path | 主な用途 |
| --- | --- | --- |
| [Contents API](./contents.md) | `/api/contents/**` | 公開記事の取得、検索、下書きのプレビュー |
| [Admin API](./admin.md) | `/api/admin/**` | モデル、記事、画像、ユーザー、権限、設定の管理 |

## 認証

連携先ごとに[管理画面の API Keys](../admin/index.md#api-keys)でキーを発行し、`Authorization: Bearer <API_KEY>` で送信します。
その連携先が必要とする[配信権限](./contents.md#認証と権限)を選びます。

Admin API はログインした利用者の権限で操作します。
セッションを管理 API 用のトークンに交換する手順は[Admin API の認証モデル](./admin.md#認証モデル)を参照します。

## 外部サイトとの連携

まず[Contents API のリクエストと応答の例](./contents.md#サンプル)を試します。
表示に必要なフィールドやロケールを指定し、画像などのファイルには応答に含まれる Worker の URL を使います。
CDN などで応答を扱う場合は[キャッシュの規則](../operations.md#キャッシュ)を確認します。

## 用語

| 用語 | 意味 |
| --- | --- |
| Model | 記事や製品など、コンテンツの種類とフィールド構成 |
| ModelField | モデル内のフィールド定義。型と設定は[フィールド定義](../admin/fields.md)を参照 |
| Entry | モデルに属する一件のコンテンツ |
| EntryField | エントリーのフィールド値 |
| Revision | 保存されたエントリーの版。公開中の版と未公開の下書きを分けて扱う |
| Locale | フィールド値の言語と地域 |
| API Key | Contents API の取得権限と対象モデルを制限するキー |

## 共通エラー

HTTP ステータスと応答の `error.code` から対処を選びます。
[Workers Logs](../operations.md#リクエストログと障害対応) で失敗したリクエストを探す場合は `X-NABECMS-Request-Id` を使います。

| Code | 確認する内容 |
| --- | --- |
| `UNAUTHORIZED` | API Key、セッション、token の不足や期限切れ |
| `FORBIDDEN` | 操作権限と対象モデルへのアクセス範囲 |
| `NOT_FOUND` | 対象の存在と公開状態 |
| `BAD_REQUEST` / `VALIDATION_ERROR` | フィールド、値、クエリの形式 |
| `DATABASE_BINDING_MISSING` | Worker の D1 binding |

認証や招待のエラーは [Admin API](./admin.md#認証と招待のエラーコード-抜粋)、配信固有のエラーは [Contents API](./contents.md) に記載しています。
