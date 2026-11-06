# Admin API

Use the Admin API to automate operations that a signed-in user can perform in the Admin UI. Check the permission matrix for your operation and the retry rules before sending entry writes.

## Authentication model

Sign in with a local email address and password. Send the resulting token as `Authorization: Bearer <access_token>`.
If you already have a Better Auth session cookie, use `GET /api/auth/get-session` to check it and `POST /api/admin/auth/session-token` to obtain a temporary Admin API token.
Better Auth sessions require both `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`. See [secret management](../security.md#secret-management) and [local authentication API](#local-authentication-api) for the available sign-in routes.

For writes to `/api/admin/auth/*` that an HTML form can send, `Origin` and `Sec-Fetch-Site` must indicate the same origin when supplied. A cross-origin request receives `403`. CLI clients can omit both headers.

## Authorization model

Admin API operations require an explicit grant. The `system.super-admin` role can perform all administrative operations.
For other roles, the API combines their `permissions.allow` rules and matches wildcard patterns such as `users:*:write` against the permission required by the route.
Entry permissions include the model, as in `entries:<modelId>:read`. A role saved in the Admin UI uses `entries:*:<action>` to cover all models.

When a route offers alternative permissions, either one is sufficient. When it performs two checks, both must pass. For example, creating a published entry requires both create and publish.

### Authorization by route

| Category | Requirement |
| --- | --- |
| [Setup and credentials](#initialization-and-authentication) | The flow verifies its secret, credentials, or cookie |
| [Invitations](#invitations) | Acceptance validates the invitation token. Management uses invitation permissions |
| `GET /api/admin/auth/me` and [personal preferences](#personal-preferences) | Valid Admin API token |
| Administrative resources | Valid Admin API token and the required permission |
| Original and variant media files | Published files can be read without authentication. Other states require authentication and `media:*:read` or `media:*:write` |

### Endpoint permission matrix

`read | write` means OR, and `A + B` means AND. `<modelId>` is the URL parameter value.

| Resource / endpoint | Required permission |
| --- | --- |
| `GET /api/admin/models`, `GET /api/admin/models/:modelId`, `GET .../dependencies` | `models:*:read` \| `models:*:write` |
| `POST /api/admin/models`, `PUT /api/admin/models/:modelId`, `DELETE /api/admin/models/:modelId` | `models:*:write` |
| `GET /api/admin/models/:modelId/fields` | `models:*:read` \| `models:*:write` |
| Field `POST` / `PUT` / `PATCH order` / `DELETE` | `models:*:write` |
| Entry list, sheet, detail, and revision list | `entries:<modelId>:read` |
| Create entry | `entries:<modelId>:create`. Published and Archived also require `entries:<modelId>:publish` |
| Update entry | `entries:<modelId>:update`. Published and Archived also require `entries:<modelId>:publish` |
| Publish or unpublish entry | `entries:<modelId>:publish` |
| Restore revision | `entries:<modelId>:update` |
| Delete entry | `entries:<modelId>:delete`. `detachReferences=true` also requires `entries:*:update` |
| Bulk entry operations | `entries:<modelId>:publish` for publish or unpublish, `entries:<modelId>:delete` for delete |
| `GET /api/admin/entry-references`, `GET /api/admin/entry-reverse-references` | `entries:*:read` |
| Media metadata and variant GET | `media:*:read` \| `media:*:write` |
| Media upload / update / delete / variant retry / transform | `media:*:write` |
| `GET /api/admin/media-references` | `media:*:read` \| `media:*:write` |
| Locale GET | `locales:*:read` \| `locales:*:write` |
| Locale POST / PATCH / DELETE | `locales:*:write` |
| Role GET | `roles:*:read` \| `roles:*:write` |
| Role POST / PUT / DELETE | `roles:*:write` |
| User GET | `users:*:read` \| `users:*:write` |
| User POST / PUT | `users:*:write` |
| User DELETE | `users:*:delete` \| `users:*:write` |
| Invite POST / GET / role-options / regenerate | `users:invite:write` \| `users:*:write` |
| API Key GET | `api_keys:*:read` \| `api_keys:*:write` |
| API Key POST / PUT / rotate / revoke / DELETE | `api_keys:*:write` |
| Media settings GET | `settings:media:read` \| `settings:media:write` |
| Media settings PUT | `settings:media:write` |
| `GET /api/admin/logs`, `GET /api/admin/logs/auth`, `GET /api/admin/dashboard` | `logs:*:read` |
| `GET /api/admin/export/content`, `GET /api/admin/export/logs` | `system.super-admin` role only |

Assigning a system role requires `system.super-admin`. See [users](#users) and [invitations](#invitations) for restrictions on account changes and role grants.

## Entry write retries and idempotency

Generate one `Idempotency-Key` for each logical write. The header is required for create, update, publish, unpublish, revision restore, delete, and bulk `action=publish`.
Use 8 to 255 ASCII letters or digits and `-`, `_`, `.`, or `:`. The Admin UI generates a UUID for you.

If a request times out, send the same method, resource, query, body, and key as the same authenticated actor. For 24 hours the API can replay the original status and body with `Idempotency-Replayed: true`. The stored request fingerprint omits the raw key and body.
The record commits with the write, so a failed write can be retried with the same key. After 24 hours, the API may accept that key as a new operation.

| Response | What to do |
| --- | --- |
| `400 IDEMPOTENCY_KEY_REQUIRED` | Supply a key |
| `400 INVALID_IDEMPOTENCY_KEY` | Correct the format |
| `409 IDEMPOTENCY_KEY_REUSED` | Reuse the key only with the original request. Generate a fresh key for a different operation |

Bulk unpublish and delete report per-entry results and can partially succeed. Inspect those results before retrying. Use `X-NABECMS-Request-Id` to find a request in [Workers Logs](../operations.md#request-logs-and-troubleshooting).
Initialization, invitation acceptance, and password reset use their own one-time checks. They do not store credentials or session tokens for replay.

## Initialization and authentication

- `GET /api/admin/system/bootstrap`
  - Returns whether setup is complete and `allowInitialize`.
- `POST /api/admin/auth/initialize`
  - Send `BOOTSTRAP_SECRET` in the `X-Nabecms-Bootstrap-Secret` header to create the first administrator with the `system.super-admin` role. An initialized app returns 409.
  - A single D1 batch creates the sentinel, system role, user, role assignment, credential account, and default locale.
- `POST /api/admin/auth/session-token`
  - Issues an Admin API `accessToken` from the Better Auth session cookie.

## Better Auth local session endpoints

- `GET /api/auth/get-session`
- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-out`

All other routes under `/api/auth/*` return `404`.

## Local authentication API

- `POST /api/admin/auth/login`
- `POST /api/admin/auth/logout`
- `POST /api/admin/auth/refresh`
- `GET /api/admin/auth/me`

## Invitations

Use `users:invite:write` or `users:*:write` to create, list, or reissue invitations. These permissions also allow reading the regular roles that can be assigned.

| Endpoint | Operation |
| --- | --- |
| `POST /api/admin/auth/invites`, `GET /api/admin/auth/invites` | Create or list invitations |
| `GET /api/admin/auth/invites/role-options` | Return eligible roles with `id`, `name`, `description`, and `isSystem` |
| `POST /api/admin/auth/invites/:inviteId/regenerate` | Replace the link and expire the previous one |
| `POST /api/admin/auth/accept-invite/validate` | Check a link before opening the acceptance form |
| `POST /api/admin/auth/accept-invite` | Redeem the token and create the account |

System roles such as `system.super-admin` cannot be assigned through an invitation, including one already issued. Creation, regeneration, resending, validation, and acceptance with a system role return `403 FORBIDDEN` and preserve the invitation.
Inviting an existing email address returns `409 USER_ALREADY_EXISTS_FOR_INVITE`.

Acceptance verifies the token, `pending` or `sent` state, and expiration as part of account creation. If the invitation becomes invalid or ineligible after validation, the request returns `410 GONE` without creating an account or session.
For delivery and regeneration steps, see [authentication email](../email.md#send-invitations).

## Models

- `GET /api/admin/models`
- `POST /api/admin/models`
- `GET /api/admin/models/:modelId`
- `PUT /api/admin/models/:modelId`
- `DELETE /api/admin/models/:modelId`
- `GET /api/admin/models/:modelId/dependencies`

## Fields

- `GET /api/admin/models/:modelId/fields`
- `POST /api/admin/models/:modelId/fields`
- `PUT /api/admin/models/:modelId/fields/:fieldId`
- `DELETE /api/admin/models/:modelId/fields/:fieldId`
- `PATCH /api/admin/models/:modelId/fields/order`

See [field definitions](../admin/fields.md) for supported values and validation.

## Entries

Use `/api/admin/models/:modelId/entries` as the base path. The paths below are relative to that base.

| Method and path | Operation |
| --- | --- |
| `GET` or `POST` at the base path | List or create entries |
| `GET /sheet` | Get rows for a sheet view |
| `GET /:entryId`, `PUT /:entryId`, `DELETE /:entryId` | Read, update, or delete one entry |
| `POST /:entryId/publish`, `POST /:entryId/unpublish` | Change publication state |
| `GET /:entryId/revisions` | List saved revisions |
| `POST /:entryId/revisions/:revisionId/restore` | Restore a revision to a new draft |
| `POST /bulk` | Operate on a selection of entries |

For `GET /sheet`, choose `mode=draft|published` and `sortOrder=asc|desc`. `sortBy=displayTitle|status|updatedAt|updatedBy|field:<fieldId>` selects the sort key, and `q=<keyword>` matches part of a display title or ID. Use `locale=<localeCode>` to prioritize a locale for sorting, with the default as a fallback.

Restoring a revision leaves the published content available until the next publish. Updating an entry to Published with `fields` omitted publishes the values from the stored revision.

An entry still referenced by a relation or rich text embed cannot be deleted. The API returns `409 ENTRY_REFERENCED`. To remove references from current published fields and the current draft before deletion, send `?detachReferences=true` with the permissions above.

For a bulk request, send 1 to 50 `entryIds`. With `action=publish`, all entries commit together and [require an idempotency key](#entry-write-retries-and-idempotency).
The API rejects a bulk publish before writing if the estimated read and write statements or the actual write statements exceed 800. With `400 ENTRY_QUERY_BUDGET_EXCEEDED`, use `error.estimatedQueries` and `error.maxQueries` to choose a smaller selection. [Cloudflare's D1 limits](../cloudflare.md#d1-limits) apply separately.

An invalid field value returns `400 FIELD_VALIDATION_FAILED` with `{ error: { code, message, fieldId, reason } }`. A missing required value uses `required field is empty` or `required field is empty for locale '<locale>'`. See [field definitions](../admin/fields.md) for accepted values and when a saved revision is checked again.

## Media

| Endpoint | Operation |
| --- | --- |
| `GET /api/admin/media` | List media with optional `type` and `search`. Use `limit` and `offset` for paginated `items` and filtered `total` |
| `POST /api/admin/media` | Upload one source file. See [upload requirements](#upload-requirements) |
| `GET /api/admin/media/:mediaId`, `PUT /api/admin/media/:mediaId` | Read or edit metadata |
| `DELETE /api/admin/media/:mediaId` | Delete the CMS record and attempt to remove the file and variants from R2 |
| `GET /api/admin/media/:mediaId/file` | Retrieve the original file |

On deletion, `204` confirms the CMS record was removed, while an unknown or already deleted ID returns `404`. See [media operations](../operations.md#media-operations) before removing leftover objects.

### Media variants

- `GET /api/admin/media/:mediaId/variants`
- `POST /api/admin/media/:mediaId/variants/transform`
- `POST /api/admin/media/:mediaId/variants/retry`
- `GET /api/admin/media-variants`
- `GET /api/admin/media-variants/:variantId/file`

### Media settings

Read or update variant templates with `GET /api/admin/settings/media` and `PUT /api/admin/settings/media`. See [media management](../admin/index.md#manage-media) for the effect of `fit` and `upscale`.

## Locales

- `GET /api/admin/locales`
- `POST /api/admin/locales`
- `PATCH /api/admin/locales/:code`
- `DELETE /api/admin/locales/:code`

## Roles

- `GET /api/admin/roles`
- `POST /api/admin/roles`
- `PUT /api/admin/roles/:roleId`
- `DELETE /api/admin/roles/:roleId`

## Users

Use `GET /api/admin/users` and `POST /api/admin/users` to list or create users. Use `PUT /api/admin/users/:userId` or `DELETE /api/admin/users/:userId` for an existing user.

Changing a Super Admin requires an actor with `system.super-admin`. An ordinary actor with `users:*:write` receives `403`.
Only the account owner can change `email`. An attempt to change another account's address returns `403 FORBIDDEN` without applying other changes in the request. Sending the current address is accepted.

Saving with `roleIds` or changing your own email revokes the user's sessions with the update.
Sending a `password` property returns `400 BAD_REQUEST`, even if empty or `null`. The owner changes their password using the [reset flow](#authentication-email).

## Personal preferences

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

## Audit and authentication logs

Both log routes require `logs:*:read`. See [audit logs](../security.md#audit-logs) for the data stored in each log.

`GET /api/admin/logs` returns activity and revision metadata. Use `action`, exact `targetId`, `dateFrom`, or `dateTo` to filter the activity list and its total. The revision results are independent. Page through the two sets with `auditLimit`, `auditOffset`, `revisionLimit`, and `revisionOffset`.
Responses include actor names, timestamps, and allowed before and after status and revision IDs. To read an entry body, use entry read permissions.

`GET /api/admin/logs/auth` returns local sign-in and invitation acceptance results. Use `result`, `reason`, `userId`, `dateFrom`, and `dateTo` to filter, and `limit` and `offset` to paginate. Use `userId` to look up a person. The [log contracts](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/contracts/logs.ts) define the response fields.

Both routes include the endpoints of the date range. Use ISO 8601 timestamps with a time zone. Date-only values start at 00:00:00 UTC, and the legacy `YYYY-MM-DD HH:mm:ss` format is UTC. Invalid dates or reversed ranges return `400 INVALID_LOG_DATE_RANGE`.

## Dashboard

- `GET /api/admin/dashboard`
  - `recentEntries[].displayTitle` uses the field selected by the model's `titleFieldId`. When a draft revision exists, it prefers the draft value. Unset or empty titles fall back to the entry ID.
  - `recentEntries[].updatedByName` is the updater's `users.name`. `updatedBy` keeps the updater's user ID.

## Resolve references

- `GET /api/admin/entry-references`
- `GET /api/admin/entry-reverse-references`
  - Returns relation fields and rich text embeds referring to the entry from current published fields or the current draft revision.
- `GET /api/admin/media-references`

## Responses

Read `error.code` and `error.message` when a request fails. See [common errors](./index.md#common-errors) for recovery steps. Operations that delete records may return `204 No Content`.

## Authentication and invitation error codes

| Code | HTTP | Common cause |
| --- | ---: | --- |
| `INITIAL_SETUP_REQUIRED` | 403 | Create the first administrator |
| `INVALID_BOOTSTRAP_SECRET` | 403 | The bootstrap secret does not match |
| `ALREADY_INITIALIZED` | 409 | Initialization was attempted on an initialized app |
| `UNAUTHORIZED` | 401 | Invalid credentials, session, or refresh token |
| `AUTH_SESSION_DISABLED` | 404 | The optional Better Auth session is disabled |
| `AUTH_CONFIGURATION_ERROR` | 500 | Better Auth session environment settings are incomplete |
| `USER_ALREADY_EXISTS_FOR_INVITE` | 409 | The user already exists |

## Upload requirements

Send one multipart source file per request, up to 50 MiB. Supported types are JPEG, PNG, GIF, PDF, MP4, WebM, MOV, MP3, WAV, and M4A. The server checks the MIME type and file signature and rejects unsupported types such as HTML and SVG.

| Status | Code |
| --- | --- |
| `400` | `INVALID_FILE_COUNT` |
| `413` | `FILE_TOO_LARGE` or `REQUEST_TOO_LARGE` |
| `415` | `UNSUPPORTED_MEDIA_TYPE` or `MEDIA_TYPE_MISMATCH` |

## Log retention settings and cleanup state

A Super Admin can read the policy and last known cleanup state with `GET /api/admin/settings/logs`. The response uses `Cache-Control: no-store` and returns `item.retentionDays`, `cleanup`, and `health`. Before the first run, `cleanup` is `null`.

To change the policy, send `PUT /api/admin/settings/logs` with `{ "retentionDays": 90 }` or `{ "retentionDays": false }` for indefinite retention. Day counts must be integers from 1 to 730000. The response is `{ item: { retentionDays } }`.
The setting takes effect on the next scheduled run. See [scheduled log cleanup](../operations.md#scheduled-log-cleanup) for operation and troubleshooting.

A read failure returns `503 LOG_MANAGEMENT_UNAVAILABLE`. A save failure returns `503 LOG_RETENTION_SAVE_FAILED`. If a connection drops during a save, fetch the policy again or retry with the same value.
See the [log management contract](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/contracts/log-management.ts) for the state fields. `cleanup.remaining: true` means expired logs remain, even when the run's status is `completed`. `null` means the job has not checked.

## Authentication email

Use these settings routes as a Super Admin after [configuring the sending environment](../email.md).

| Endpoint | Operation |
| --- | --- |
| `GET /api/admin/settings/email` | Read saved settings, environment status, and the latest sending result |
| `PUT /api/admin/settings/email` | Set `senderName`, `invitesEnabled`, and `passwordResetEnabled` |
| `POST /api/admin/settings/email/test` | Send a test to the signed-in Super Admin |

The public `GET /api/admin/auth/email-capabilities` route returns booleans for available features.
Set `sendEmail: true` when creating an invitation. If sending fails after creation, the API still returns `201` with the token and delivery result.
Use `POST /api/admin/auth/invites/:inviteId/send` with invitation management permission to resend the same link. An ineligible role returns `403`, an invalid invitation or one needing regeneration returns `409`, and a sending failure returns `502`.

To request a password reset, send `{ email }` to `POST /api/admin/auth/request-password-reset`. A valid request accepted for processing receives the same response regardless of account existence or delivery result.
Send the token from the email and the new password as `{ token, newPassword }` to `POST /api/admin/auth/reset-password`. See the [reset guide](../email.md#reset-a-password) for expiration and session behavior.
