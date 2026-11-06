# Security

Before opening a deployment to users, decide who can sign in, which content delivery clients can see, and who can inspect activity.
Use the [deployment guide](./operations.md) for the setup commands.

## Secret management

Register production secrets in Cloudflare Secrets and use different values for local development.
Protect `BOOTSTRAP_SECRET` because anyone with that value can create the first administrator on an uninitialized deployment.
Use a separate random value for each secret, and rotate exposed credentials promptly.
For required values and their storage locations, see [environment variables and Secrets](./cloudflare.md#environment-variables-and-secrets).

## Local authentication and Better Auth sessions

Users sign in with a local email address and password. NabeCMS stores password hashes with bcrypt.
Admin API tokens depend on a valid session, so revoking a session also blocks its tokens. Changes to a user's roles revoke their sessions.
Only Super Admins can update protected Super Admin accounts.

Keep password resets and email address changes under the account owner's control.
To let owners set a new password from a one-time link, set up [authentication email](./email.md#reset-a-password).
The [Admin API reference](./api/admin.md#users) covers the restrictions on user updates.

If the Worker sits behind a reverse proxy, forward `Origin` and `Sec-Fetch-Site`. Authentication writes that can be sent by HTML forms use these headers to reject cross-origin requests.
The [Admin API authentication model](./api/admin.md#authentication-model) explains supported sign-in and session routes.

## Contents API visibility

Use `isPrivate` to keep a model or field out of content delivery. Allowing a model in an API key cannot make a private model public.
Review the [Contents API visibility rules](./api/contents.md#caching-and-visibility) for direct requests and references.

## API keys

Treat delivery keys as secrets. Issue one per integration and grant only the `permissions` and `allowedModels` it needs.
Revoke the old key after rotation. Use the [Admin UI](./admin/index.md#api-keys) to manage keys.

## Invitations

Create regular roles for the permissions that invitees should receive. The app comes without a predefined Admin role, and system roles such as `system.super-admin` cannot be granted through invitations.
Change existing users' permissions through user editing.

Share a copied invitation link through a channel only the invitee can access. Each invitation is single-use.
For sending and regenerating links, see [authentication email](./email.md#send-invitations).
For the API behavior when an invitation is no longer usable, see [Admin API invitations](./api/admin.md#invitations).

## Rate limiting

Configure both [rate limit bindings](./cloudflare.md#fixed-routes-and-bindings) in production. If a binding is unavailable, protected requests return `503 AUTH_RATE_LIMIT_UNAVAILABLE`.
Sign-in allows ten attempts per minute for the same email address across both login routes. Other protected actions use the sensitive binding, with five attempts per minute for the applicable route, token, actor, or reset identifier.
Excess requests return `429 AUTH_RATE_LIMITED` and `Retry-After: 60`.

The binding receives opaque identifiers. Rate limit logs report the operation, binding, outcome, status, and request ID without the email address or token.
Cloudflare maintains counters by location with eventual consistency, so use this limit to reduce abuse. See [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) for counter behavior.

## Media delivery

Keep public access, `r2.dev`, and custom domains disabled on the R2 bucket. Serve files through the Worker's media routes.
The Worker checks publication status on each request. Draft and archived files require authentication and media permissions.
For allowed uploads, see [upload requirements](./api/admin.md#upload-requirements). For what deletion does to existing files and requests, see [media operations](./operations.md#media-operations).

## Audit logs

Activity logs record actions on entries, models, and settings. Entry writes and their audit records commit together.
Authentication logs record local sign-in results and invitation acceptance. Inspect both types under [Logs](./admin/index.md#view-and-search-logs) with `logs:*:read`.

The logs store actor IDs, timestamps, outcomes, and change metadata. Entry bodies belong to revisions and require entry read permissions.
The logs omit credentials, request bodies, email addresses, IP addresses, and session identifiers. See the [log API](./api/admin.md#audit-and-authentication-logs) for the response fields and filters.

## Log retention and cleanup

Retention covers activity and authentication logs. Entries, revisions, sessions, and Workers Logs have separate lifecycles.
The daily job deletes records strictly older than its UTC start time minus the configured period. It skips deletion when it cannot read or validate the setting.
Eligible records may wait for a later run when the job reaches its limit or encounters a failure.

Choose the period in [Log management](./admin/index.md#log-management). Shortening it makes existing older records eligible for deletion.
See [scheduled log cleanup](./operations.md#scheduled-log-cleanup) for the schedule and how to diagnose failed runs.
