/**
 * Drizzle schema entry point for the internal NabeCMS dev app.
 *
 * Re-export the core NabeCMS tables and extend this file with development-
 * specific tables when this repository needs them.
 */
import { schema as coreSchema } from "@nekobato/nabecms-core";

export const {
  models,
  modelFields,
  entries,
  entryFields,
  entryRevisions,
  scheduledPublicationActions,
  media,
  mediaVariants,
  locales,
  users,
  userRoles,
  authIdentities,
  authAccounts,
  authCredentials,
  authInvites,
  authSessions,
  authVerifications,
  authFlowStates,
  authLoginEvents,
  roles,
  apiKeys,
  integrations,
  webhooks,
  webhookDeliveryLogs,
  auditLogs,
  idempotencyRecords,
  settings,
  logCleanupState,
} = coreSchema;

/**
 * Export custom tables below so drizzle-kit can pick them up.
 */
