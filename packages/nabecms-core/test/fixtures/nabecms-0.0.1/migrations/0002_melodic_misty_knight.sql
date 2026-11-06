-- NOTE:
-- The column additions in this migration were already applied by
-- 0001_auth_foundation.sql. Keep 0002 idempotent to avoid failures on
-- existing local/remote databases.
CREATE UNIQUE INDEX IF NOT EXISTS `auth_identities_provider_subject_unique` ON `auth_identities` (`provider`,`subject`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_identities_user_provider_idx` ON `auth_identities` (`user_id`,`provider`);
