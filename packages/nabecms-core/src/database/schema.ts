import type { AuditLogSnapshot } from "../lib/audit-log";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { ModelFieldOptions, UserPreferences } from "../contracts";

// Models table - Content type definitions
export const models = sqliteTable("models", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  isPrivate: integer("is_private", { mode: "boolean" })
    .notNull()
    .default(false),
  titleFieldId: text("title_field_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// ModelFields table - Fields for each model
export const modelFields = sqliteTable(
  "model_fields",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    fieldKey: text("field_key").notNull(),
    type: text("type", {
      enum: [
        "text",
        "rich_text",
        "number",
        "date",
        "list",
        "media",
        "json",
        "relation",
        "boolean",
        "custom",
      ],
    }).notNull(), // text, rich_text, number, date, list, media, json, relation, boolean, custom
    // renamed (was `order`) to a neutral name
    position: integer("position").notNull(),
    required: integer("required", { mode: "boolean" }).notNull(),
    hasLocales: integer("has_locales", { mode: "boolean" }).notNull(),
    isUnique: integer("is_unique", { mode: "boolean" })
      .notNull()
      .default(false),
    variant: text("variant"), // type-specific discriminant
    options: text("options", {
      mode: "json",
    }).$type<ModelFieldOptions | null>(),
    defaultValue: text("default_value", { mode: "json" }).$type<any>(),
    isPrivate: integer("is_private", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    // 同一モデル内でのフィールド名重複を禁止
    uniqueIndex("model_fields_model_id_name_unique").on(
      table.modelId,
      table.name,
    ),
    uniqueIndex("model_fields_model_id_field_key_unique").on(
      table.modelId,
      table.fieldKey,
    ),
  ],
);

// Entries table - Content instances
export const entries = sqliteTable(
  "entries",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("draft"), // draft, published, archived
    currentDraftRevisionId: text("current_draft_revision_id"),
    publishedRevisionId: text("published_revision_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    publishedAt: text("published_at"),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    index("entries_model_status_updated_idx").on(
      table.modelId,
      table.status,
      table.updatedAt,
    ),
    index("entries_published_at_idx").on(table.publishedAt),
    index("entries_current_draft_idx").on(table.currentDraftRevisionId),
    index("entries_published_revision_idx").on(table.publishedRevisionId),
  ],
);

// EntryFields table - Field values for entries
export const entryFields = sqliteTable(
  "entry_fields",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    fieldId: text("field_id")
      .notNull()
      .references(() => modelFields.id, { onDelete: "cascade" }),
    locale: text("locale")
      .notNull()
      .references(() => locales.code, { onDelete: "cascade" }),
    valueString: text("value_string"),
    valueNumber: real("value_number"),
    valueDate: text("value_date"),
    valueBoolean: integer("value_boolean", { mode: "boolean" }),
    valueJson: text("value_json", { mode: "json" }).$type<any>(),
    valueMedia: text("value_media"), // Media ID
    valueRelation: text("value_relation", { mode: "json" }).$type<any>(), // Related entry IDs
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("entry_fields_entry_field_locale_unique").on(
      table.entryId,
      table.fieldId,
      table.locale,
    ),
  ],
);

// EntryRevisions table - Version history
export const entryRevisions = sqliteTable(
  "entry_revisions",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    content: text("content", { mode: "json" }).notNull().$type<any>(), // Snapshot of EntryFields
    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("draft"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    publishedAt: text("published_at"),
  },
  (table) => [
    uniqueIndex("entry_revisions_entry_revision_unique").on(
      table.entryId,
      table.revisionNumber,
    ),
    index("entry_revisions_entry_status_idx").on(table.entryId, table.status),
  ],
);

// ScheduledPublicationActions table - Future publish/unpublish actions
export const scheduledPublicationActions = sqliteTable(
  "scheduled_publication_actions",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    entryId: text("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    revisionId: text("revision_id").references(() => entryRevisions.id, {
      onDelete: "set null",
    }),
    action: text("action", { enum: ["publish", "unpublish"] }).notNull(),
    status: text("status", {
      enum: ["pending", "processing", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("pending"),
    scheduledAt: text("scheduled_at").notNull(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id),
    lockedAt: text("locked_at"),
    executedAt: text("executed_at"),
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("scheduled_publication_due_idx").on(table.status, table.scheduledAt),
    index("scheduled_publication_entry_idx").on(
      table.entryId,
      table.scheduledAt,
    ),
    index("scheduled_publication_revision_idx").on(table.revisionId),
  ],
);

// Media table - File storage
export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id").notNull(),
    url: text("url").notNull(),
    type: text("type").notNull(), // MIME type category
    mimeType: text("mime_type").notNull(), // Full MIME type
    name: text("name").notNull(),
    description: text("description"),
    width: integer("width"),
    height: integer("height"),
    size: integer("size").notNull(), // File size in bytes
    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("published"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id),
  },
  (table) => [index("media_group_idx").on(table.groupId)],
);

// MediaVariants table - Derived images for each media asset
export const mediaVariants = sqliteTable(
  "media_variants",
  {
    id: text("id").primaryKey(),
    mediaId: text("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    templateKey: text("template_key").notNull(),
    url: text("url"),
    width: integer("width"),
    height: integer("height"),
    size: integer("size"),
    mimeType: text("mime_type"),
    format: text("format"),
    status: text("status", {
      enum: ["pending", "processing", "succeeded", "failed"],
    })
      .notNull()
      .default("pending"),
    provider: text("provider", { enum: ["frontend", "cloudflare"] }).notNull(),
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("media_variants_media_template_unique").on(
      table.mediaId,
      table.templateKey,
    ),
    index("media_variants_status_idx").on(table.status),
    index("media_variants_media_id_idx").on(table.mediaId),
  ],
);

// Locales table - Internationalization
export const locales = sqliteTable("locales", {
  code: text("code").primaryKey(), // en-US, ja-JP, etc.
  isDefault: integer("is_default", { mode: "boolean" }).notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Users table - Admin users
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  // Deprecated compatibility column. Credential hashes live in auth_accounts.
  password: text("password").notNull().default("!"),
  name: text("name").notNull().default(""),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  roleId: text("role_id", { mode: "json" })
    .notNull()
    .$type<string[]>()
    .default(sql`'[]'`), // Array of role IDs
  uiPreferences: text("ui_preferences", { mode: "json" })
    .$type<UserPreferences | null>()
    .default(null),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Auth tables (separate from domain users) to support multiple providers
export const authIdentities = sqliteTable(
  "auth_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'local' | 'google' | 'apple' | 'github' | ...
    subject: text("subject").notNull(), // Provider user id or local subject
    email: text("email"),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("auth_identities_provider_subject_unique").on(
      table.provider,
      table.subject,
    ),
    index("auth_identities_user_provider_idx").on(table.userId, table.provider),
  ],
);

export const authAccounts = sqliteTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(), // google | credential | apple | ...
    accountId: text("account_id").notNull(), // provider subject
    password: text("password_hash"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    scope: text("scope"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("auth_accounts_provider_account_unique").on(
      table.providerId,
      table.accountId,
    ),
    index("auth_accounts_user_idx").on(table.userId),
  ],
);

export const authCredentials = sqliteTable("auth_credentials", {
  id: text("id").primaryKey(),
  identityId: text("identity_id")
    .notNull()
    .references(() => authIdentities.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("password"), // password (for local)
  passwordHash: text("password_hash").notNull(), // bcrypt hash
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const authInvites = sqliteTable(
  "auth_invites",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    roleIds: text("role_ids", { mode: "json" }).notNull().$type<string[]>(),
    tokenHash: text("token_hash").notNull(),
    tokenExpiresAt: text("token_expires_at").notNull(),
    status: text("status", {
      enum: ["pending", "sent", "consumed", "expired", "revoked"],
    })
      .notNull()
      .default("pending"),
    sentAt: text("sent_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    consumedByUserId: text("consumed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    metadata: text("metadata", { mode: "json" }).$type<Record<
      string,
      any
    > | null>(),
  },
  (table) => [
    uniqueIndex("auth_invites_token_hash_unique").on(table.tokenHash),
    index("auth_invites_email_idx").on(table.email),
    index("auth_invites_status_idx").on(table.status),
    index("auth_invites_expires_idx").on(table.tokenExpiresAt),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    legacyRefreshTokenHash: text("legacy_refresh_token_hash"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_unique").on(table.token),
    uniqueIndex("auth_sessions_legacy_refresh_token_hash_unique").on(
      table.legacyRefreshTokenHash,
    ),
    index("auth_sessions_user_idx").on(table.userId),
  ],
);

export const authVerifications = sqliteTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)],
);

export const authFlowStates = sqliteTable(
  "auth_flow_states",
  {
    id: text("id").primaryKey(),
    flow: text("flow").notNull(), // login | initialize | invite
    provider: text("provider").notNull(), // google | apple | discord | ...
    inviteTokenHash: text("invite_token_hash"),
    defaultLocale: text("default_locale"),
    redirectSuccess: text("redirect_success"),
    redirectError: text("redirect_error"),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("auth_flow_states_expires_idx").on(table.expiresAt),
    index("auth_flow_states_provider_flow_idx").on(table.provider, table.flow),
  ],
);

export const authLoginEvents = sqliteTable(
  "auth_login_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    result: text("result").notNull(), // success | failed | locked
    reason: text("reason"), // invalid_password | user_not_found | locked | other
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("auth_login_events_created_idx").on(table.createdAt),
    index("auth_login_events_cleanup_idx").on(
      sql`julianday(${table.createdAt})`,
      table.id,
    ),
    index("auth_login_events_user_idx").on(table.userId),
    index("auth_login_events_result_idx").on(table.result),
    index("auth_login_events_reason_idx").on(table.reason),
  ],
);

// Roles table - User roles
export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  permissions: text("permissions", { mode: "json" }).notNull().$type<any>(),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// User to roles relation (next auth model)
export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("user_roles_user_role_unique").on(table.userId, table.roleId),
  ],
);

// API Keys table
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  keyHash: text("key_hash"),
  name: text("name").notNull(),
  description: text("description"),
  permissions: text("permissions", { mode: "json" }).notNull().$type<any[]>(),
  allowedModels: text("allowed_models", { mode: "json" }).$type<
    string[] | null
  >(),
  isRevoked: integer("is_revoked", { mode: "boolean" })
    .notNull()
    .default(false),
  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  revokedBy: text("revoked_by").references(() => users.id, {
    onDelete: "set null",
  }),
  revokedAt: text("revoked_at"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Integrations table - External service integrations
export const integrations = sqliteTable("integrations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // webhook, external API, etc.
  config: text("config", { mode: "json" }).notNull().$type<any>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Webhooks table - Event hooks
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  event: text("event").notNull(), // legacy single event (kept for compatibility)
  url: text("url").notNull(),
  method: text("method").notNull(),
  headers: text("headers", { mode: "json" }).$type<any>(), // legacy
  body: text("body", { mode: "json" }).$type<any>(), // legacy
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  secret: text("secret"),
  eventFilters: text("event_filters", { mode: "json" }).$type<
    string[] | null
  >(),
  customHeaders: text("custom_headers", { mode: "json" }).$type<Record<
    string,
    string
  > | null>(),
  timeoutMs: integer("timeout_ms"),
  maxRetries: integer("max_retries"),
  backoffStrategy: text("backoff_strategy"),
  concurrency: integer("concurrency"),
  status: text("status"), // active | paused | errored
  bodyTemplate: text("body_template"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const webhookDeliveryLogs = sqliteTable("webhook_delivery_logs", {
  id: text("id").primaryKey(),
  webhookId: text("webhook_id")
    .notNull()
    .references(() => webhooks.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull(), // success | failed | skipped
  attempt: integer("attempt").notNull(),
  responseCode: integer("response_code"),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  payload: text("payload", { mode: "json" }).$type<any>(),
  responseBody: text("response_body"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Audit Logs table - Activity tracking
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    action: text("action").notNull(), // create, update, delete, etc.
    targetTable: text("target_table").notNull(),
    targetId: text("target_id").notNull(),
    before: text("before", { mode: "json" }).$type<AuditLogSnapshot>(),
    after: text("after", { mode: "json" }).$type<AuditLogSnapshot>(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("audit_logs_cleanup_idx").on(
      sql`julianday(${table.createdAt})`,
      table.id,
    ),
    index("audit_logs_target_idx").on(
      table.targetTable,
      table.targetId,
      table.createdAt,
    ),
  ],
);

// Idempotency records - Replays completed Admin Entry mutations safely
export const idempotencyRecords = sqliteTable(
  "idempotency_records",
  {
    id: text("id").primaryKey(),
    principalId: text("principal_id").notNull(),
    operation: text("operation").notNull(),
    keyHash: text("key_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: text("response_body").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_records_principal_operation_key_unique").on(
      table.principalId,
      table.operation,
      table.keyHash,
    ),
    index("idempotency_records_expires_idx").on(table.expiresAt),
  ],
);

// Settings table - System configuration
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull().$type<any>(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Single durable status/lease record for bounded log cleanup.
export const logCleanupState = sqliteTable("log_cleanup_state", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  leaseExpiresAt: text("lease_expires_at").notNull(),
  finishedAt: text("finished_at"),
  lastSuccessAt: text("last_success_at"),
  cutoff: text("cutoff"),
  auditDeleted: integer("audit_deleted").notNull().default(0),
  authDeleted: integer("auth_deleted").notNull().default(0),
  remaining: integer("remaining", { mode: "boolean" }),
  errorCode: text("error_code"),
});
