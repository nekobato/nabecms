/**
 * Drizzle schema entry point for the basic reference app.
 *
 * Re-export the core NabeCMS tables and extend this file with app-specific
 * tables when the reference app needs them.
 */
import { schema as coreSchema } from "@nekobato/nabecms";

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
