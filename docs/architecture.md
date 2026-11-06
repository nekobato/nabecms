# Architecture

## Overview

A single Cloudflare Worker serves the API and Admin UI. Core mounts the APIs with Hono, and the Admin UI uses Vue, Vite, and Element Plus.
For the production resources and binding names, see [Cloudflare requirements](./cloudflare.md).
For the packages that own these parts, see [repository structure](./developer.md#repository-structure).

## Request flow

The Admin UI exchanges its Better Auth session cookie for a temporary Admin API token, then uses that token to edit records.
External clients use API keys to read content through the Contents API. Each API checks the caller's permissions before handing a request to the resource service.
The [API overview](./api/index.md) describes the credentials and response conventions.

D1 holds CMS data and R2 holds media files.
Media requests pass through the Worker, which uses publication state and permissions to decide whether it can serve the file. See [media delivery](./security.md#media-delivery).

## Data model

A model defines the fields of an entry. Revisions keep saved versions so an editor can change a draft while readers continue to see the published version.
An entry's fields can refer to media and entries in other models. The Contents API can [include those records in the response](./api/contents.md#relation-expansion).

For tables, columns, and constraints, see the [Core schema](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/database/schema.ts).

## Write consistency

An entry write commits its revision, published values, and activity record together in D1. Bulk publishing commits the entire selection together.
If a write fails, these records roll back together. If the response is lost, use the [Admin API retry rules](./api/admin.md#entry-write-retries-and-idempotency) to recover the result.

Initialization, invitation acceptance, and password reset also commit related database changes together.
A [migration](./data-management.md#migrations) records its history entry in the same batch as its SQL.

## Core and host app responsibilities

NabeCMS provides the CMS schema, APIs, authentication, and Admin UI. The host app owns the Worker entry point, deployment configuration, and application-specific data.
To add tables without coupling them to changes in the CMS schema, follow [schema extensions](./data-management.md#extend-the-schema).
