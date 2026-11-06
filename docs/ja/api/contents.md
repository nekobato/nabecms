# Contents API

外部サイトや配信用クライアントは、Contents API から公開済みのエントリーを取得します。
[リクエストと応答の例](#サンプル)では、取得したエントリーから関連先とファイルを参照できます。

## 認証と権限

`contents:read` を持つキーを `Authorization: Bearer <API_KEY>` で送信します。
編集者向けに下書きを表示する場合は、キーに `contents:preview` を追加し、`draft=true` を指定します。
キーの権限には `contents:read`、`contents:preview`、`contents:manage` があります。

`allowedModels` が未設定か空の場合、公開条件を満たすすべてのモデルが対象です。
モデルを指定した場合は一覧と詳細が指定範囲に絞られ、エントリーのリクエストで範囲外のモデルを指定すると `403` を返します。

## キャッシュと公開条件 {#キャッシュ方針}

コンテンツの応答はキーと公開状態によって変わるため、`Cache-Control: private, no-store` を返します。
`ETag` と `Last-Modified` は応答の確認に使います。
CDN や共有プロキシでの扱いは[キャッシュの規則](../operations.md#キャッシュ)を参照します。

非公開モデルは、キーで許可していても直接取得や検索に `404` を返します。
リレーションの展開やリッチテキストの参照からも除外します。
非公開フィールドだけが参照するメディアは `included.assets` に含めません。

## サンプル

日本語の記事を一覧で取得し、関連エントリーとメディアを応答に含めます。
アセットの URL は CMS の Worker 内のパスです。

```http
GET /api/contents/models/blog/entries?locale=ja-JP&include=media,relations&sort=-publishedAt&limit=10
Authorization: Bearer sk_live_xxx
```

```json
{
  "items": [
    {
      "id": "entry_pub",
      "modelId": "blog",
      "status": "published",
      "locale": "ja-JP",
      "fields": {
        "title": "カフェ案内",
        "hero": "media_1",
        "gallery": ["media_1", "media_2"],
        "tags": ["coffee", "guide"],
        "scores": [4, 5],
        "dates": ["2026-03-10"],
        "flags": [true, false]
      },
      "relations": {
        "author": { "type": "one", "entryIds": ["author_1"] }
      }
    }
  ],
  "included": {
    "entries": [
      {
        "id": "author_1",
        "modelId": "author",
        "status": "published",
        "locale": "ja-JP",
        "fields": {
          "name": "アリス・スミス",
          "avatar": "media_2"
        }
      }
    ],
    "assets": [
      {
        "id": "media_1",
        "url": "/api/admin/media/media_1/file",
        "width": 1600,
        "height": 900
      },
      {
        "id": "media_2",
        "url": "/api/admin/media/media_2/file",
        "width": 800,
        "height": 800
      }
    ]
  },
  "errors": [],
  "page": 1,
  "limit": 10,
  "total": 1,
  "lastUpdatedAt": "2025-03-03T00:00:00Z"
}
```

## エンドポイント

モデルの情報やエントリーは GET で取得できます。
絞り込み条件を JSON で送る場合は POST を使います。

### エンドポイントごとの権限 {#endpoint-permission-matrix}

| エンドポイント | 取得できる内容 | 必要な権限 |
| --- | --- | --- |
| `GET /api/contents/health` | Worker、API、D1 の疎通 | 認証不要 |
| `GET /api/contents/models` | 公開モデルの一覧。非公開フィールドは省く | `contents:read` |
| `GET /api/contents/models/:modelId` | モデルの詳細。取得できない場合は `404` | `contents:read` |
| `GET /api/contents/models/:modelId/entries` | エントリーの一覧 | `contents:read` |
| `GET /api/contents/models/:modelId/entries/:entryId` | エントリー一件。取得できない場合は `404` | `contents:read` |
| `POST /api/contents/query` | 本文で指定したモデルのエントリー一覧 | `contents:read` |

エントリーの取得や検索で `draft=true` を指定する場合は `contents:preview` も必要です。
認証を要するルートでは[モデルの範囲](#認証と権限)も検査します。

ヘルスチェックの応答には `status`、`service`、`timestamp` と、`runtime`、`api`、`db` の `checks` が含まれます。
正常時は `200`、利用できない場合は `503` を返し、キャッシュは `Cache-Control: no-store` です。

エントリーの GET では `locale`、`fields`、`include`、`sort`、`page`、`limit`、`since`、`draft`、`filters` を指定できます。
`include` を省略すると関連エントリーとメディアを展開し、`include=0` では両方を省略します。
POST では一つの `modelId` と、必要に応じて `locales`、`fields`、`includeMedia`、`includeRelations`、`includeAssets`、`sort`、`page`、`limit`、`since`、`draft`、`filters` を本文に指定します。

## レスポンス共通フィールド

一覧のエントリーは `items`、一件のエントリーは `item` から取得します。
`fields` にはリクエストで指定したロケールの優先順が反映されます。

| キー | 内容 |
| --- | --- |
| `included.entries` | 関連エントリー。取得対象の `items` や `item` に含まれるものは除く |
| `included.assets` | 取得対象と関連エントリーのメディア。ID が同じものはまとめる |
| `errors` | 参照先の削除、未公開、権限不足などによる `UNRESOLVABLE_LINK` |
| `page`、`limit`、`total` | 一覧のページ情報 |
| `lastUpdatedAt` | 一覧の最終更新時刻。`Last-Modified` に使用する |

## list field の返却型

リストは配列で返し、空なら `[]` です。
`options.item.type` が `text` か `date` の場合は `string[]` で、日付は `YYYY-MM-DD` です。
`number` では `number[]`、`boolean` では `boolean[]` を返します。

## relation 展開

`include=relations` を指定すると、フィールドの `{ type, entryIds }` を残したまま、参照先を `included.entries` に含めます。
展開するのは直接参照する一階層です。
`include=relations.author` のようにパスを指定した場合も、現在は `relations` と同じ範囲を展開します。
関連先が参照するファイルを取得する場合は `media` も指定します。

リッチテキストの `entryReference` は、同じリクエスト条件で参照先を取得できる場合に残ります。
下書きのプレビューでは下書きへの参照も残ります。
リッチテキストの参照先は `included.entries` に展開せず、取得できない参照は `errors` に含めずにノードを除きます。

## media 展開

`single` のフィールド値は ID か `null`、`multiple` の値は ID の配列か `[]` です。
ロケールごとに異なるファイルを参照でき、ファイル本体はロケール間で共有します。

ID を `included.assets` と照合し、`url` は CMS の Worker のオリジンに対して解決します。
未公開または欠落したメディアは、フィールドの ID を残し、`included.assets` から省きます。

GET で `include` を指定する場合、アセットを受け取るには `media` を含めます。
POST の `includeMedia=false` または `includeAssets=false` では、フィールドの ID を残し、`included.assets` は空になります。

## filters

GET では入れ子のクエリパラメーターで、POST では同じ構造の JSON を `filters` で指定します。
複数の条件は既定で `$and` として組み合わせます。
ロケール別のフィールドは、`locale=ja-JP,en-US` などリクエストの優先順に従って評価します。

対象は公開フィールドの `text`、`number`、`date`、`boolean` です。
対象外の型や、GET のフィルターのパスに `__proto__`、`constructor`、`prototype` が含まれる場合は `422 VALIDATION_ERROR` を返します。

### 採用演算子

| 用途 | 演算子 |
| --- | --- |
| 等価 | `$eq`、`$ne` |
| 大小比較 | `$lt`、`$lte`、`$gt`、`$gte` |
| 集合への所属 | `$in`、`$notIn` |
| 値の有無 | `$null`、`$notNull` |
| 文字列の一致 | `$contains`、`$startsWith`、`$endsWith` |
| 条件の組み合わせ | `$and`、`$or`、`$not` |

### 記法例

```http
GET /api/contents/models/blog/entries?filters[slug][$eq]=cafe-guide
Authorization: Bearer sk_live_xxx
```

```http
GET /api/contents/models/blog/entries?filters[rating][$gte]=4&filters[featured][$eq]=true
Authorization: Bearer sk_live_xxx
```

```http
GET /api/contents/models/blog/entries?filters[$or][0][title][$contains]=Cafe&filters[$or][1][title][$contains]=Coffee
Authorization: Bearer sk_live_xxx
```

```json
{
  "modelId": "blog",
  "filters": {
    "featured": { "$eq": true },
    "rating": { "$gte": 4 },
    "$or": [
      { "title": { "$contains": "Cafe" } },
      { "fields.slug": { "$eq": "cafe-guide" } }
    ]
  }
}
```

## TypeScript での型付け

モデルのフィールド定義を扱うときは、`@nekobato/nabecms/contracts` から `FieldType`、`FieldOptionsMap`、`FieldVariantMap` をインポートできます。
受け取った値を検査し、フィールドの `type` に合わせてオプションとバリアントを扱います。
Hono のクライアント型には `@nekobato/nabecms/rpc/contents` の `ContentsAppType` を使います。
詳細は[インポート先](../configuration.md#import-path)と[フィールドの型定義](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/contracts/model-field.ts)を参照します。

## エラー例

- 401: `{"error":{"code":"UNAUTHORIZED","message":"Missing bearer token"}}`
- 403: `{"error":{"code":"FORBIDDEN","message":"contents:preview required"}}`
- 404: `{"error":{"code":"NOT_FOUND","message":"Entry not found"}}`
- 422: `{"error":{"code":"VALIDATION_ERROR","issues":[{"path":["filters","author"],"message":"Field type 'relation' is not supported in filters"}]}}`
