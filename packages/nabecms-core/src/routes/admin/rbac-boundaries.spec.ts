import { beforeEach, describe, expect, it, vi } from "vitest";

const authzMocks = vi.hoisted(() => ({
  actor: { id: "user_limited", roleIds: ["role_limited"] },
  requireActor: vi.fn(),
  requirePermission: vi.fn(),
}));

const entryServiceMocks = vi.hoisted(() => ({
  deleteEntry: vi.fn(),
}));

const idempotencyMocks = vi.hoisted(() => ({
  prepareIdempotencyRequest: vi.fn(),
}));

vi.mock("./_authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_authz")>();
  return {
    ...actual,
    requireActor: authzMocks.requireActor,
    requirePermission: authzMocks.requirePermission,
  };
});

vi.mock("../../services/entries", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../services/entries")>();
  return {
    ...actual,
    deleteEntry: entryServiceMocks.deleteEntry,
  };
});

vi.mock("../../services/idempotency", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../services/idempotency")>();
  return {
    ...actual,
    prepareIdempotencyRequest: idempotencyMocks.prepareIdempotencyRequest,
  };
});

import app from "./index";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type RequiredPermission = string | readonly string[];

type BoundaryCase = {
  name: string;
  method: HttpMethod;
  path: string;
  requirements: readonly RequiredPermission[];
  deniedPermission: string;
  body?: unknown;
  serviceMustNotRun?: "deleteEntry";
};

type RouteAccess =
  | "credential-flow"
  | "actor"
  | "permission"
  | "published-or-permission"
  | "super-admin";

type RouteContract = {
  method: HttpMethod | "ALL";
  path: string;
  access: RouteAccess;
};

const MODEL_READ = ["models:*:read", "models:*:write"] as const;
const MEDIA_READ = ["media:*:read", "media:*:write"] as const;
const LOCALES_READ = ["locales:*:read", "locales:*:write"] as const;
const MEDIA_SETTINGS_READ = [
  "settings:media:read",
  "settings:media:write",
] as const;

const routeContracts: readonly RouteContract[] = [
  { method: "ALL", path: "/api/admin/auth/*", access: "credential-flow" },
  { method: "ALL", path: "/api/admin/settings/email*", access: "super-admin" },
  { method: "GET", path: "/api/admin/settings/email", access: "super-admin" },
  { method: "PUT", path: "/api/admin/settings/email", access: "super-admin" },
  {
    method: "POST",
    path: "/api/admin/settings/email/test",
    access: "super-admin",
  },
  {
    method: "GET",
    path: "/api/admin/auth/email-capabilities",
    access: "credential-flow",
  },
  {
    method: "POST",
    path: "/api/admin/auth/request-password-reset",
    access: "credential-flow",
  },
  {
    method: "POST",
    path: "/api/admin/auth/reset-password",
    access: "credential-flow",
  },
  {
    method: "POST",
    path: "/api/admin/auth/invites/:inviteId/send",
    access: "permission",
  },
  { method: "ALL", path: "/api/admin/settings/logs", access: "super-admin" },
  { method: "GET", path: "/api/admin/settings/logs", access: "super-admin" },
  { method: "PUT", path: "/api/admin/settings/logs", access: "super-admin" },
  { method: "GET", path: "/api/admin/export/content", access: "super-admin" },
  { method: "GET", path: "/api/admin/export/logs", access: "super-admin" },
  {
    method: "GET",
    path: "/api/admin/system/bootstrap",
    access: "credential-flow",
  },
  {
    method: "POST",
    path: "/api/admin/auth/initialize",
    access: "credential-flow",
  },
  {
    method: "POST",
    path: "/api/admin/auth/login",
    access: "credential-flow",
  },
  {
    method: "POST",
    path: "/api/admin/auth/logout",
    access: "credential-flow",
  },
  {
    method: "POST",
    path: "/api/admin/auth/refresh",
    access: "credential-flow",
  },
  {
    method: "POST",
    path: "/api/admin/auth/session-token",
    access: "credential-flow",
  },
  {
    method: "POST",
    path: "/api/admin/auth/accept-invite/validate",
    access: "credential-flow",
  },
  {
    method: "POST",
    path: "/api/admin/auth/accept-invite",
    access: "credential-flow",
  },
  {
    method: "GET",
    path: "/api/admin/auth/me",
    access: "actor",
  },
  {
    method: "GET",
    path: "/api/admin/user-preferences",
    access: "actor",
  },
  {
    method: "PUT",
    path: "/api/admin/user-preferences",
    access: "actor",
  },
  { method: "GET", path: "/api/admin/models", access: "permission" },
  { method: "POST", path: "/api/admin/models", access: "permission" },
  {
    method: "GET",
    path: "/api/admin/models/:modelId",
    access: "permission",
  },
  {
    method: "PUT",
    path: "/api/admin/models/:modelId",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/models/:modelId/dependencies",
    access: "permission",
  },
  {
    method: "DELETE",
    path: "/api/admin/models/:modelId",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/models/:modelId/fields",
    access: "permission",
  },
  {
    method: "POST",
    path: "/api/admin/models/:modelId/fields",
    access: "permission",
  },
  {
    method: "PATCH",
    path: "/api/admin/models/:modelId/fields/order",
    access: "permission",
  },
  {
    method: "PUT",
    path: "/api/admin/models/:modelId/fields/:fieldId",
    access: "permission",
  },
  {
    method: "DELETE",
    path: "/api/admin/models/:modelId/fields/:fieldId",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/models/:modelId/entries",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/models/:modelId/entries/sheet",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/models/:modelId/entries/:entryId",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/models/:modelId/entries/:entryId/revisions",
    access: "permission",
  },
  {
    method: "POST",
    path: "/api/admin/models/:modelId/entries",
    access: "permission",
  },
  {
    method: "PUT",
    path: "/api/admin/models/:modelId/entries/:entryId",
    access: "permission",
  },
  {
    method: "POST",
    path: "/api/admin/models/:modelId/entries/:entryId/publish",
    access: "permission",
  },
  {
    method: "POST",
    path: "/api/admin/models/:modelId/entries/:entryId/revisions/:revisionId/restore",
    access: "permission",
  },
  {
    method: "POST",
    path: "/api/admin/models/:modelId/entries/:entryId/unpublish",
    access: "permission",
  },
  {
    method: "DELETE",
    path: "/api/admin/models/:modelId/entries/:entryId",
    access: "permission",
  },
  {
    method: "POST",
    path: "/api/admin/models/:modelId/entries/bulk",
    access: "permission",
  },
  { method: "GET", path: "/api/admin/media", access: "permission" },
  { method: "POST", path: "/api/admin/media", access: "permission" },
  {
    method: "GET",
    path: "/api/admin/media/:mediaId",
    access: "permission",
  },
  {
    method: "PUT",
    path: "/api/admin/media/:mediaId",
    access: "permission",
  },
  {
    method: "DELETE",
    path: "/api/admin/media/:mediaId",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/media/:mediaId/file",
    access: "published-or-permission",
  },
  { method: "GET", path: "/api/admin/locales", access: "permission" },
  { method: "POST", path: "/api/admin/locales", access: "permission" },
  {
    method: "PATCH",
    path: "/api/admin/locales/:code",
    access: "permission",
  },
  {
    method: "DELETE",
    path: "/api/admin/locales/:code",
    access: "permission",
  },
  { method: "GET", path: "/api/admin/roles", access: "permission" },
  { method: "POST", path: "/api/admin/roles", access: "permission" },
  {
    method: "PUT",
    path: "/api/admin/roles/:roleId",
    access: "permission",
  },
  {
    method: "DELETE",
    path: "/api/admin/roles/:roleId",
    access: "permission",
  },
  { method: "GET", path: "/api/admin/users", access: "permission" },
  { method: "POST", path: "/api/admin/users", access: "permission" },
  {
    method: "PUT",
    path: "/api/admin/users/:userId",
    access: "permission",
  },
  {
    method: "DELETE",
    path: "/api/admin/users/:userId",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/entry-references",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/entry-reverse-references",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/media-references",
    access: "permission",
  },
  { method: "GET", path: "/api/admin/api-keys", access: "permission" },
  {
    method: "POST",
    path: "/api/admin/api-keys",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/api-keys/:id",
    access: "permission",
  },
  {
    method: "PUT",
    path: "/api/admin/api-keys/:id",
    access: "permission",
  },
  {
    method: "POST",
    path: "/api/admin/api-keys/:id/rotate",
    access: "permission",
  },
  {
    method: "POST",
    path: "/api/admin/api-keys/:id/revoke",
    access: "permission",
  },
  {
    method: "DELETE",
    path: "/api/admin/api-keys/:id",
    access: "permission",
  },
  {
    method: "POST",
    path: "/api/admin/auth/invites",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/auth/invites",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/auth/invites/role-options",
    access: "permission",
  },
  {
    method: "POST",
    path: "/api/admin/auth/invites/:inviteId/regenerate",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/settings/media",
    access: "permission",
  },
  {
    method: "PUT",
    path: "/api/admin/settings/media",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/media/:mediaId/variants",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/media-variants",
    access: "permission",
  },
  {
    method: "POST",
    path: "/api/admin/media/:mediaId/variants/retry",
    access: "permission",
  },
  {
    method: "POST",
    path: "/api/admin/media/:mediaId/variants/transform",
    access: "permission",
  },
  {
    method: "GET",
    path: "/api/admin/media-variants/:variantId/file",
    access: "published-or-permission",
  },
  {
    method: "GET",
    path: "/api/admin/dashboard",
    access: "permission",
  },
  { method: "GET", path: "/api/admin/logs", access: "permission" },
  {
    method: "GET",
    path: "/api/admin/logs/auth",
    access: "permission",
  },
] as const;

const boundaryCases: readonly BoundaryCase[] = [
  {
    name: "invite role options",
    method: "GET",
    path: "/api/admin/auth/invites/role-options",
    requirements: [["users:invite:write", "users:*:write"]],
    deniedPermission: "users:invite:write",
  },
  {
    name: "invite email",
    method: "POST",
    path: "/api/admin/auth/invites/invite_1/send",
    requirements: [["users:invite:write", "users:*:write"]],
    deniedPermission: "users:invite:write",
  },
  {
    name: "model list",
    method: "GET",
    path: "/api/admin/models",
    requirements: [MODEL_READ],
    deniedPermission: "models:*:read",
  },
  {
    name: "model creation",
    method: "POST",
    path: "/api/admin/models",
    requirements: ["models:*:write"],
    deniedPermission: "models:*:write",
  },
  {
    name: "model detail",
    method: "GET",
    path: "/api/admin/models/model_1",
    requirements: [MODEL_READ],
    deniedPermission: "models:*:read",
  },
  {
    name: "model update",
    method: "PUT",
    path: "/api/admin/models/model_1",
    requirements: ["models:*:write"],
    deniedPermission: "models:*:write",
  },
  {
    name: "model dependencies",
    method: "GET",
    path: "/api/admin/models/model_1/dependencies",
    requirements: [MODEL_READ],
    deniedPermission: "models:*:read",
  },
  {
    name: "model deletion",
    method: "DELETE",
    path: "/api/admin/models/model_1",
    requirements: ["models:*:write"],
    deniedPermission: "models:*:write",
  },
  {
    name: "model field list",
    method: "GET",
    path: "/api/admin/models/model_1/fields",
    requirements: [MODEL_READ],
    deniedPermission: "models:*:read",
  },
  {
    name: "model field creation",
    method: "POST",
    path: "/api/admin/models/model_1/fields",
    requirements: ["models:*:write"],
    deniedPermission: "models:*:write",
  },
  {
    name: "model field reorder",
    method: "PATCH",
    path: "/api/admin/models/model_1/fields/order",
    requirements: ["models:*:write"],
    deniedPermission: "models:*:write",
  },
  {
    name: "model field update",
    method: "PUT",
    path: "/api/admin/models/model_1/fields/field_1",
    requirements: ["models:*:write"],
    deniedPermission: "models:*:write",
  },
  {
    name: "model field deletion",
    method: "DELETE",
    path: "/api/admin/models/model_1/fields/field_1",
    requirements: ["models:*:write"],
    deniedPermission: "models:*:write",
  },
  {
    name: "entry list",
    method: "GET",
    path: "/api/admin/models/model_1/entries",
    requirements: ["entries:model_1:read"],
    deniedPermission: "entries:model_1:read",
  },
  {
    name: "entry sheet",
    method: "GET",
    path: "/api/admin/models/model_1/entries/sheet",
    requirements: ["entries:model_1:read"],
    deniedPermission: "entries:model_1:read",
  },
  {
    name: "entry detail",
    method: "GET",
    path: "/api/admin/models/model_1/entries/entry_1",
    requirements: ["entries:model_1:read"],
    deniedPermission: "entries:model_1:read",
  },
  {
    name: "entry revisions",
    method: "GET",
    path: "/api/admin/models/model_1/entries/entry_1/revisions",
    requirements: ["entries:model_1:read"],
    deniedPermission: "entries:model_1:read",
  },
  {
    name: "draft entry creation",
    method: "POST",
    path: "/api/admin/models/model_1/entries",
    requirements: ["entries:model_1:create"],
    deniedPermission: "entries:model_1:create",
    body: { status: "draft" },
  },
  {
    name: "published entry creation",
    method: "POST",
    path: "/api/admin/models/model_1/entries",
    requirements: ["entries:model_1:create", "entries:model_1:publish"],
    deniedPermission: "entries:model_1:publish",
    body: { status: "published" },
  },
  {
    name: "archived entry creation",
    method: "POST",
    path: "/api/admin/models/model_1/entries",
    requirements: ["entries:model_1:create", "entries:model_1:publish"],
    deniedPermission: "entries:model_1:publish",
    body: { status: "archived" },
  },
  {
    name: "draft entry update",
    method: "PUT",
    path: "/api/admin/models/model_1/entries/entry_1",
    requirements: ["entries:model_1:update"],
    deniedPermission: "entries:model_1:update",
    body: { status: "draft" },
  },
  {
    name: "published entry update",
    method: "PUT",
    path: "/api/admin/models/model_1/entries/entry_1",
    requirements: ["entries:model_1:update", "entries:model_1:publish"],
    deniedPermission: "entries:model_1:publish",
    body: { status: "published" },
  },
  {
    name: "archived entry update",
    method: "PUT",
    path: "/api/admin/models/model_1/entries/entry_1",
    requirements: ["entries:model_1:update", "entries:model_1:publish"],
    deniedPermission: "entries:model_1:publish",
    body: { status: "archived" },
  },
  {
    name: "entry publish",
    method: "POST",
    path: "/api/admin/models/model_1/entries/entry_1/publish",
    requirements: ["entries:model_1:publish"],
    deniedPermission: "entries:model_1:publish",
    body: {},
  },
  {
    name: "entry revision restore",
    method: "POST",
    path: "/api/admin/models/model_1/entries/entry_1/revisions/revision_1/restore",
    requirements: ["entries:model_1:update"],
    deniedPermission: "entries:model_1:update",
  },
  {
    name: "entry unpublish",
    method: "POST",
    path: "/api/admin/models/model_1/entries/entry_1/unpublish",
    requirements: ["entries:model_1:publish"],
    deniedPermission: "entries:model_1:publish",
  },
  {
    name: "entry deletion",
    method: "DELETE",
    path: "/api/admin/models/model_1/entries/entry_1",
    requirements: ["entries:model_1:delete"],
    deniedPermission: "entries:model_1:delete",
  },
  {
    name: "entry deletion with cross-model reference detachment",
    method: "DELETE",
    path: "/api/admin/models/model_1/entries/entry_1?detachReferences=true",
    requirements: ["entries:model_1:delete", "entries:*:update"],
    deniedPermission: "entries:*:update",
    serviceMustNotRun: "deleteEntry",
  },
  {
    name: "bulk entry publish",
    method: "POST",
    path: "/api/admin/models/model_1/entries/bulk",
    requirements: ["entries:model_1:publish"],
    deniedPermission: "entries:model_1:publish",
    body: { action: "publish", entryIds: ["entry_1"] },
  },
  {
    name: "bulk entry unpublish",
    method: "POST",
    path: "/api/admin/models/model_1/entries/bulk",
    requirements: ["entries:model_1:publish"],
    deniedPermission: "entries:model_1:publish",
    body: { action: "unpublish", entryIds: ["entry_1"] },
  },
  {
    name: "bulk entry deletion",
    method: "POST",
    path: "/api/admin/models/model_1/entries/bulk",
    requirements: ["entries:model_1:delete"],
    deniedPermission: "entries:model_1:delete",
    body: { action: "delete", entryIds: ["entry_1"] },
  },
  {
    name: "entry references",
    method: "GET",
    path: "/api/admin/entry-references?entryId=entry_1",
    requirements: ["entries:*:read"],
    deniedPermission: "entries:*:read",
  },
  {
    name: "entry reverse references",
    method: "GET",
    path: "/api/admin/entry-reverse-references?entryId=entry_1",
    requirements: ["entries:*:read"],
    deniedPermission: "entries:*:read",
  },
  {
    name: "media list",
    method: "GET",
    path: "/api/admin/media",
    requirements: [MEDIA_READ],
    deniedPermission: "media:*:read",
  },
  {
    name: "media upload",
    method: "POST",
    path: "/api/admin/media",
    requirements: ["media:*:write"],
    deniedPermission: "media:*:write",
  },
  {
    name: "media detail",
    method: "GET",
    path: "/api/admin/media/media_1",
    requirements: [MEDIA_READ],
    deniedPermission: "media:*:read",
  },
  {
    name: "media update",
    method: "PUT",
    path: "/api/admin/media/media_1",
    requirements: ["media:*:write"],
    deniedPermission: "media:*:write",
  },
  {
    name: "media deletion",
    method: "DELETE",
    path: "/api/admin/media/media_1",
    requirements: ["media:*:write"],
    deniedPermission: "media:*:write",
  },
  {
    name: "authenticated media file",
    method: "GET",
    path: "/api/admin/media/media_1/file",
    requirements: [MEDIA_READ],
    deniedPermission: "media:*:read",
  },
  {
    name: "media references",
    method: "GET",
    path: "/api/admin/media-references?mediaId=media_1",
    requirements: [MEDIA_READ],
    deniedPermission: "media:*:read",
  },
  {
    name: "media variant list for one file",
    method: "GET",
    path: "/api/admin/media/media_1/variants",
    requirements: [MEDIA_READ],
    deniedPermission: "media:*:read",
  },
  {
    name: "global media variant list",
    method: "GET",
    path: "/api/admin/media-variants",
    requirements: [MEDIA_READ],
    deniedPermission: "media:*:read",
  },
  {
    name: "media variant retry",
    method: "POST",
    path: "/api/admin/media/media_1/variants/retry",
    requirements: ["media:*:write"],
    deniedPermission: "media:*:write",
    body: {},
  },
  {
    name: "media variant transform",
    method: "POST",
    path: "/api/admin/media/media_1/variants/transform",
    requirements: ["media:*:write"],
    deniedPermission: "media:*:write",
    body: {},
  },
  {
    name: "authenticated media variant file",
    method: "GET",
    path: "/api/admin/media-variants/variant_1/file",
    requirements: [MEDIA_READ],
    deniedPermission: "media:*:read",
  },
  {
    name: "locale list",
    method: "GET",
    path: "/api/admin/locales",
    requirements: [LOCALES_READ],
    deniedPermission: "locales:*:read",
  },
  {
    name: "locale creation",
    method: "POST",
    path: "/api/admin/locales",
    requirements: ["locales:*:write"],
    deniedPermission: "locales:*:write",
  },
  {
    name: "locale update",
    method: "PATCH",
    path: "/api/admin/locales/ja",
    requirements: ["locales:*:write"],
    deniedPermission: "locales:*:write",
  },
  {
    name: "locale deletion",
    method: "DELETE",
    path: "/api/admin/locales/ja",
    requirements: ["locales:*:write"],
    deniedPermission: "locales:*:write",
  },
  {
    name: "role list",
    method: "GET",
    path: "/api/admin/roles",
    requirements: [["roles:*:read", "roles:*:write"]],
    deniedPermission: "roles:*:read",
  },
  {
    name: "role creation",
    method: "POST",
    path: "/api/admin/roles",
    requirements: ["roles:*:write"],
    deniedPermission: "roles:*:write",
  },
  {
    name: "role update",
    method: "PUT",
    path: "/api/admin/roles/role_1",
    requirements: ["roles:*:write"],
    deniedPermission: "roles:*:write",
  },
  {
    name: "role deletion",
    method: "DELETE",
    path: "/api/admin/roles/role_1",
    requirements: ["roles:*:write"],
    deniedPermission: "roles:*:write",
  },
  {
    name: "user list",
    method: "GET",
    path: "/api/admin/users",
    requirements: [["users:*:read", "users:*:write"]],
    deniedPermission: "users:*:read",
  },
  {
    name: "user creation",
    method: "POST",
    path: "/api/admin/users",
    requirements: ["users:*:write"],
    deniedPermission: "users:*:write",
  },
  {
    name: "user update",
    method: "PUT",
    path: "/api/admin/users/user_1",
    requirements: ["users:*:write"],
    deniedPermission: "users:*:write",
  },
  {
    name: "user deletion",
    method: "DELETE",
    path: "/api/admin/users/user_1",
    requirements: [["users:*:delete", "users:*:write"]],
    deniedPermission: "users:*:delete",
  },
  {
    name: "API key list",
    method: "GET",
    path: "/api/admin/api-keys",
    requirements: [["api_keys:*:read", "api_keys:*:write"]],
    deniedPermission: "api_keys:*:read",
  },
  {
    name: "API key creation",
    method: "POST",
    path: "/api/admin/api-keys",
    requirements: ["api_keys:*:write"],
    deniedPermission: "api_keys:*:write",
  },
  {
    name: "API key detail",
    method: "GET",
    path: "/api/admin/api-keys/key_1",
    requirements: [["api_keys:*:read", "api_keys:*:write"]],
    deniedPermission: "api_keys:*:read",
  },
  {
    name: "API key update",
    method: "PUT",
    path: "/api/admin/api-keys/key_1",
    requirements: ["api_keys:*:write"],
    deniedPermission: "api_keys:*:write",
  },
  {
    name: "API key rotation",
    method: "POST",
    path: "/api/admin/api-keys/key_1/rotate",
    requirements: ["api_keys:*:write"],
    deniedPermission: "api_keys:*:write",
  },
  {
    name: "API key revocation",
    method: "POST",
    path: "/api/admin/api-keys/key_1/revoke",
    requirements: ["api_keys:*:write"],
    deniedPermission: "api_keys:*:write",
  },
  {
    name: "API key deletion",
    method: "DELETE",
    path: "/api/admin/api-keys/key_1",
    requirements: ["api_keys:*:write"],
    deniedPermission: "api_keys:*:write",
  },
  {
    name: "invite creation",
    method: "POST",
    path: "/api/admin/auth/invites",
    requirements: [["users:invite:write", "users:*:write"]],
    deniedPermission: "users:invite:write",
  },
  {
    name: "invite list",
    method: "GET",
    path: "/api/admin/auth/invites",
    requirements: [["users:invite:write", "users:*:write"]],
    deniedPermission: "users:invite:write",
  },
  {
    name: "invite regeneration",
    method: "POST",
    path: "/api/admin/auth/invites/invite_1/regenerate",
    requirements: [["users:invite:write", "users:*:write"]],
    deniedPermission: "users:invite:write",
  },
  {
    name: "media settings read",
    method: "GET",
    path: "/api/admin/settings/media",
    requirements: [MEDIA_SETTINGS_READ],
    deniedPermission: "settings:media:read",
  },
  {
    name: "media settings update",
    method: "PUT",
    path: "/api/admin/settings/media",
    requirements: ["settings:media:write"],
    deniedPermission: "settings:media:write",
  },
  {
    name: "audit logs",
    method: "GET",
    path: "/api/admin/logs",
    requirements: ["logs:*:read"],
    deniedPermission: "logs:*:read",
  },
  {
    name: "authentication logs",
    method: "GET",
    path: "/api/admin/logs/auth",
    requirements: ["logs:*:read"],
    deniedPermission: "logs:*:read",
  },
  {
    name: "dashboard audit and statistics",
    method: "GET",
    path: "/api/admin/dashboard",
    requirements: ["logs:*:read"],
    deniedPermission: "logs:*:read",
  },
] as const;

/** Return whether a permission requirement contains a concrete value. */
const includesPermission = (
  requirement: RequiredPermission,
  permission: string,
): boolean =>
  Array.isArray(requirement)
    ? requirement.includes(permission)
    : requirement === permission;

/** Build a stable key for comparing route contracts. */
const routeKey = ({
  method,
  path,
}: Pick<RouteContract, "method" | "path">): string => `${method} ${path}`;

/** Return whether a concrete request path matches a route template. */
const matchesRoutePath = (routePath: string, requestPath: string): boolean => {
  const requestPathname = new URL(requestPath, "https://nabecms.test").pathname;
  const routeSegments = routePath.split("/");
  const requestSegments = requestPathname.split("/");
  return (
    routeSegments.length === requestSegments.length &&
    routeSegments.every(
      (segment, index) =>
        segment.startsWith(":") || segment === requestSegments[index],
    )
  );
};

/** Resolve the most specific route contract for a boundary request. */
const resolveRouteContract = (
  boundaryCase: Pick<BoundaryCase, "method" | "path">,
): RouteContract => {
  const matches = routeContracts
    .filter(
      (contract) =>
        contract.method === boundaryCase.method &&
        matchesRoutePath(contract.path, boundaryCase.path),
    )
    .sort(
      (left, right) =>
        left.path.split("/:").length - right.path.split("/:").length,
    );
  const contract = matches[0];
  if (!contract) {
    throw new Error(
      `No route contract for ${boundaryCase.method} ${boundaryCase.path}`,
    );
  }
  return contract;
};

const permissionRouteSamples = routeContracts
  .filter((contract) => contract.access === "permission")
  .map((contract) => {
    const boundaryCase = boundaryCases.find(
      (candidate) =>
        routeKey(resolveRouteContract(candidate)) === routeKey(contract),
    );
    if (!boundaryCase) {
      throw new Error(`No permission boundary case for ${routeKey(contract)}`);
    }
    return {
      name: routeKey(contract),
      method: contract.method,
      path: boundaryCase.path,
    };
  });

const actorRouteSamples = routeContracts
  .filter((contract) => contract.access === "actor")
  .map((contract) => ({
    name: routeKey(contract),
    method: contract.method,
    path: contract.path,
  }));

describe("mounted Admin API RBAC boundaries", () => {
  beforeEach(() => {
    authzMocks.requireActor.mockReset();
    authzMocks.requirePermission.mockReset();
    entryServiceMocks.deleteEntry.mockReset();
    idempotencyMocks.prepareIdempotencyRequest.mockReset();
    authzMocks.requireActor.mockResolvedValue(authzMocks.actor);
    idempotencyMocks.prepareIdempotencyRequest.mockResolvedValue({
      kind: "execute",
      record: {
        id: "idempotency_rbac",
        principalId: authzMocks.actor.id,
        operation: "entry.delete",
        keyHash: "key_hash",
        requestHash: "request_hash",
        createdAt: "2026-07-30T00:00:00.000Z",
        expiresAt: "2026-07-31T00:00:00.000Z",
      },
    });
  });

  it("classifies every mounted route and covers every permission route", () => {
    const contractKeys = routeContracts.map(routeKey);
    expect(new Set(contractKeys).size).toBe(contractKeys.length);

    const mountedRouteKeys = Array.from(
      new Set(app.routes.map(({ method, path }) => `${method} ${path}`)),
    ).sort();
    expect(mountedRouteKeys).toEqual([...contractKeys].sort());

    const permissionContractKeys = routeContracts
      .filter(
        (contract) =>
          contract.access === "permission" ||
          contract.access === "published-or-permission",
      )
      .map(routeKey)
      .sort();
    const testedPermissionKeys = Array.from(
      new Set(
        boundaryCases.map((boundaryCase) =>
          routeKey(resolveRouteContract(boundaryCase)),
        ),
      ),
    ).sort();
    expect(testedPermissionKeys).toEqual(permissionContractKeys);
  });

  it.each([...permissionRouteSamples, ...actorRouteSamples])(
    "blocks an unauthenticated request from $name before side effects",
    async ({ method, path }) => {
      const dbPrepare = vi.fn();
      authzMocks.requireActor.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "UNAUTHORIZED",
              message: "Invalid access token",
            },
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        ),
      );

      const response = await app.request(path, { method }, {
        WORKER_ENV: "test",
        DB: { prepare: dbPrepare },
        R2: {},
      } as never);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid access token",
        },
      });
      expect(authzMocks.requirePermission).not.toHaveBeenCalled();
      expect(dbPrepare).not.toHaveBeenCalled();
      expect(entryServiceMocks.deleteEntry).not.toHaveBeenCalled();
    },
  );

  it.each(boundaryCases)(
    "blocks a low-privilege actor from $name",
    async ({
      method,
      path,
      requirements,
      deniedPermission,
      body,
      serviceMustNotRun,
    }) => {
      const dbPrepare = vi.fn();
      authzMocks.requirePermission.mockImplementation(
        async (_c, _actor, requirement: RequiredPermission) =>
          includesPermission(requirement, deniedPermission)
            ? new Response(
                JSON.stringify({
                  error: {
                    code: "FORBIDDEN",
                    message: "Missing permission",
                  },
                }),
                {
                  status: 403,
                  headers: { "content-type": "application/json" },
                },
              )
            : undefined,
      );

      const response = await app.request(
        path,
        {
          method,
          headers: {
            authorization: "Bearer low-privilege-token",
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        {
          WORKER_ENV: "test",
          DB: { prepare: dbPrepare },
          R2: {},
        } as never,
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: {
          code: "FORBIDDEN",
          message: "Missing permission",
        },
      });
      expect(authzMocks.requireActor).toHaveBeenCalled();
      expect(authzMocks.requirePermission).toHaveBeenCalledTimes(
        requirements.length,
      );
      requirements.forEach((requirement, index) => {
        expect(authzMocks.requirePermission).toHaveBeenNthCalledWith(
          index + 1,
          expect.anything(),
          authzMocks.actor,
          requirement,
        );
      });
      expect(dbPrepare).not.toHaveBeenCalled();
      if (serviceMustNotRun === "deleteEntry") {
        expect(entryServiceMocks.deleteEntry).not.toHaveBeenCalled();
      }
    },
  );

  it("does not require cross-model update permission for a restricted entry deletion", async () => {
    authzMocks.requirePermission.mockResolvedValue(undefined);
    entryServiceMocks.deleteEntry.mockResolvedValue({
      id: "entry_1",
      modelId: "model_1",
      status: "draft",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      publishedAt: null,
    });

    const response = await app.request(
      "/api/admin/models/model_1/entries/entry_1",
      {
        method: "DELETE",
        headers: {
          authorization: "Bearer limited-token",
          "idempotency-key": "entry-delete-rbac-key",
        },
      },
      {
        WORKER_ENV: "test",
        DB: { prepare: vi.fn() },
        R2: {},
      } as never,
    );

    expect(response.status).toBe(204);
    expect(authzMocks.requirePermission).toHaveBeenCalledTimes(1);
    expect(authzMocks.requirePermission).toHaveBeenCalledWith(
      expect.anything(),
      authzMocks.actor,
      "entries:model_1:delete",
    );
    expect(entryServiceMocks.deleteEntry).toHaveBeenCalledWith(
      expect.anything(),
      {
        actorId: authzMocks.actor.id,
        entryId: "entry_1",
        modelId: "model_1",
        referenceAction: "restrict",
      },
    );
  });
});
