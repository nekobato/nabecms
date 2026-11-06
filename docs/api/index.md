# API overview

Use the Contents API to deliver content to external sites and the Admin API to build administration interfaces and tools.

| API | Path | Common uses |
| --- | --- | --- |
| [Contents API](./contents.md) | `/api/contents/**` | Retrieve and search published articles, and preview drafts |
| [Admin API](./admin.md) | `/api/admin/**` | Manage models, articles, images, users, permissions, and settings |

## Authentication

Issue a Contents API key under [API Keys](../admin/index.md#api-keys) for each integration. Use `Authorization: Bearer <API_KEY>` and choose [delivery permissions](./contents.md#authentication-and-permissions) for that client.

The Admin API acts with the signed-in user's permissions. Use the [Admin API authentication guide](./admin.md#authentication-model) to exchange a session for a bearer token.

## External integrations

Start with the [Contents API request and response example](./contents.md#request-and-response-example). Request the fields and locales the site needs, and use the returned Worker URLs for files.
See [caching](../operations.md#caching) before adding a shared cache.

## Terminology

| Term | Meaning |
| --- | --- |
| Model | A content type, such as an article or product, and its field structure |
| ModelField | A field definition within a model. See [field definitions](../admin/fields.md) for types and options |
| Entry | One item of content in a model |
| EntryField | A field value for an entry |
| Revision | A saved version of an entry. The published version and unpublished draft are separate |
| Locale | Language and region of a field value |
| API Key | A key that limits Contents API permissions and allowed models |

## Common errors

Check the HTTP status and read the response's `error.code` to choose a recovery action. Use `X-NABECMS-Request-Id` when looking up a failed request in [Workers Logs](../operations.md#request-logs-and-troubleshooting).

| Code | What to check |
| --- | --- |
| `UNAUTHORIZED` | Missing or expired API key, session, or token |
| `FORBIDDEN` | Operation permissions and access to the target model |
| `NOT_FOUND` | Whether the item exists and is published |
| `BAD_REQUEST` / `VALIDATION_ERROR` | Field, value, or query format |
| `DATABASE_BINDING_MISSING` | The Worker's D1 binding |

For authentication and invitation errors, see the [Admin API](./admin.md#authentication-and-invitation-error-codes).
For content delivery errors, see the [Contents API](./contents.md).
