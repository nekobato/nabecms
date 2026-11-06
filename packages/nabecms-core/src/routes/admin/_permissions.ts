/** Permissions accepted by read-only model schema endpoints. */
export const MODEL_READ_PERMISSIONS = [
  "models:*:read",
  "models:*:write",
] as const;

/** Permission required by model schema mutation endpoints. */
export const MODEL_WRITE_PERMISSION = "models:*:write" as const;

/** Permissions accepted by read-only media endpoints. */
export const MEDIA_READ_PERMISSIONS = [
  "media:*:read",
  "media:*:write",
] as const;

/** Permission required by media mutation endpoints. */
export const MEDIA_WRITE_PERMISSION = "media:*:write" as const;

/** Permissions accepted by read-only locale endpoints. */
export const LOCALES_READ_PERMISSIONS = [
  "locales:*:read",
  "locales:*:write",
] as const;

/** Permission required by locale mutation endpoints. */
export const LOCALES_WRITE_PERMISSION = "locales:*:write" as const;

/** Permissions accepted by the media settings read endpoint. */
export const MEDIA_SETTINGS_READ_PERMISSIONS = [
  "settings:media:read",
  "settings:media:write",
] as const;

/** Permission required by the media settings mutation endpoint. */
export const MEDIA_SETTINGS_WRITE_PERMISSION = "settings:media:write" as const;

/** Permission required to read audit, authentication, and dashboard logs. */
export const LOGS_READ_PERMISSION = "logs:*:read" as const;

/** Permission required to update references owned by arbitrary models. */
export const ENTRY_GLOBAL_UPDATE_PERMISSION = "entries:*:update" as const;

/** Actions represented by the entry permission contract. */
export type EntryPermissionAction =
  "create" | "read" | "update" | "delete" | "publish";

/**
 * Build the concrete permission checked for an entry operation.
 * @param modelId - Model owning the entry
 * @param action - Entry operation
 * @returns Concrete entry permission
 */
export const entryPermission = (
  modelId: string,
  action: EntryPermissionAction,
): string => `entries:${modelId}:${action}`;
