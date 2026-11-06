# Contents API

Use the Contents API to retrieve published entries for a website or another delivery client. Start with the [request example](#request-and-response-example) to see how a response links entries and files.

## Authentication and permissions

Send `Authorization: Bearer <API_KEY>` with a key that has `contents:read`. For an editorial preview, add `contents:preview` to the key and set `draft=true`.
The fixed scopes are `contents:read`, `contents:preview`, and `contents:manage`.

An unset or empty `allowedModels` covers all models subject to the publication rules. With an explicit list, model responses are limited to those IDs, and entry requests that specify another model return `403`.

## Caching and visibility

Content responses vary by key and publication state and return `Cache-Control: private, no-store`. `ETag` and `Last-Modified` describe the response. See [caching](../operations.md#caching) for shared cache behavior.

A private model returns `404` on direct requests even if the key allows it. Relation expansion and rich text also omit private entries. Assets referenced only by private fields are excluded from `included.assets`.

## Request and response example

This request gets a page of Japanese entries and includes their related entries and assets. Each asset URL is a path on the CMS Worker.

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

## Endpoints

Use GET for model metadata and to read an entry or list. Use the POST query when the client sends filter objects as JSON.

### Endpoint permission matrix

| Endpoint | Result | Required scope |
| --- | --- | --- |
| `GET /api/contents/health` | Worker, API, and D1 health | Public |
| `GET /api/contents/models` | Public models with private fields omitted | `contents:read` |
| `GET /api/contents/models/:modelId` | One model, or `404` if unavailable | `contents:read` |
| `GET /api/contents/models/:modelId/entries` | A page of entries | `contents:read` |
| `GET /api/contents/models/:modelId/entries/:entryId` | One entry, or `404` if unavailable | `contents:read` |
| `POST /api/contents/query` | A page of entries for the model in the body | `contents:read` |

Entry reads and queries with `draft=true` also require `contents:preview`.
The [model restrictions](#authentication-and-permissions) apply to every authenticated endpoint.

The health response includes `status`, `service`, `timestamp`, and `checks` for `runtime`, `api`, and `db`.
It returns `200` when healthy or `503` when unavailable, with `Cache-Control: no-store`.

Entry GET requests accept `locale`, `fields`, `include`, `sort`, `page`, `limit`, `since`, `draft`, and `filters`. Omit `include` to expand related entries and media, or set `include=0` to omit both.
For POST, supply one `modelId` and any of `locales`, `fields`, `includeMedia`, `includeRelations`, `includeAssets`, `sort`, `page`, `limit`, `since`, `draft`, and `filters`.

## Common response fields

Use `items` for a list or `item` for one entry. Its `fields` reflect the requested locale preferences.

| Field | Contents |
| --- | --- |
| `included.entries` | Referenced entries, excluding entries already in the primary result |
| `included.assets` | Media referenced by primary and included entries, deduplicated by ID |
| `errors` | `UNRESOLVABLE_LINK` results for relation targets that are missing, unpublished, or outside the key's access |
| `page`, `limit`, `total` | List pagination |
| `lastUpdatedAt` | Latest modification in the list, used for `Last-Modified` |

## List field response types

A list returns an array and uses `[]` for an empty value. With `options.item.type` set to `text` or `date` the result is `string[]`, with dates in `YYYY-MM-DD`. Use `number` or `boolean` for `number[]` or `boolean[]`.

## Relation expansion

With `include=relations`, the primary entry keeps `{ type, entryIds }`. Look up those IDs in `included.entries`. Expansion follows one level of direct references. A path such as `include=relations.author` currently enables the same expansion as `relations`.
Include `media` as well to retrieve assets referenced by the related entries.

A rich text `entryReference` is kept only if its target is retrievable with the current request. Preview requests can keep draft references. Rich text references do not expand into `included.entries`. The API removes inaccessible nodes from the rich text without adding them to `errors`.

## Media expansion

A `single` media field returns an ID or `null`, and a `multiple` field returns an array of IDs or `[]`. Localized values may refer to different IDs. The asset itself is shared across locales.

Match the ID to an object in `included.assets` and resolve its `url` against the CMS Worker origin. A missing or unpublished object is omitted, while the reference in the field remains.

For a GET request with an explicit `include`, include the bare `media` option to receive assets. In POST, `includeMedia=false` or `includeAssets=false` leaves the references in place and empties `included.assets`.

## Filters

GET uses nested query parameters, and POST uses the equivalent JSON in `filters`. Multiple conditions combine with an implicit `$and`. Localized fields use the request's locale priority, such as `locale=ja-JP,en-US`.

Filter on public `text`, `number`, `date`, and `boolean` fields. Unsupported field types and GET filter paths containing `__proto__`, `constructor`, or `prototype` return `422 VALIDATION_ERROR`.

### Supported operators

| Purpose | Operators |
| --- | --- |
| Equality | `$eq`, `$ne` |
| Comparison | `$lt`, `$lte`, `$gt`, `$gte` |
| Membership | `$in`, `$notIn` |
| Missing value | `$null`, `$notNull` |
| Text matching | `$contains`, `$startsWith`, `$endsWith` |
| Logical combination | `$and`, `$or`, `$not` |

### Filter syntax examples

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

## TypeScript types

Import `FieldType`, `FieldOptionsMap`, and `FieldVariantMap` from `@nekobato/nabecms/contracts` to work with model field definitions. Use the field's `type` to interpret its variant and options after validating the API payload.
For a typed Hono client, use `ContentsAppType` from `@nekobato/nabecms/rpc/contents`. See [package exports](../configuration.md#import-paths) and the [field contracts](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/contracts/model-field.ts).

## Error examples

- 401 returns `{"error":{"code":"UNAUTHORIZED","message":"Missing bearer token"}}`
- 403 returns `{"error":{"code":"FORBIDDEN","message":"contents:preview required"}}`
- 404 returns `{"error":{"code":"NOT_FOUND","message":"Entry not found"}}`
- 422 returns `{"error":{"code":"VALIDATION_ERROR","issues":[{"path":["filters","author"],"message":"Field type 'relation' is not supported in filters"}]}}`
