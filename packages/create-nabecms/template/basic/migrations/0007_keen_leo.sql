PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
UPDATE `users`
SET `password` = COALESCE(NULLIF(`password`, '!'), NULLIF(`password_hash`, ''), '!')
WHERE `password` = '!' OR `password` = '';--> statement-breakpoint
UPDATE `users`
SET `name` = COALESCE(NULLIF(`name`, ''), NULLIF(`display_name`, ''), `email`)
WHERE `name` = '';--> statement-breakpoint
INSERT OR IGNORE INTO `roles` (`id`, `name`, `description`, `permissions`, `is_system`)
SELECT 'system.super-admin', 'Super Admin', 'System reserved role with full privileges', '{"allow":["*"]}', true
WHERE EXISTS (SELECT 1 FROM `users` WHERE `is_owner` = 1);--> statement-breakpoint
UPDATE `users`
SET `role_id` = CASE
	WHEN json_valid(`role_id`) THEN
		CASE
			WHEN json_type(`role_id`) = 'array' THEN
				CASE
					WHEN EXISTS (
						SELECT 1
						FROM json_each(`users`.`role_id`)
						WHERE value = 'system.super-admin'
					) THEN `role_id`
					ELSE json_insert(`role_id`, '$[#]', 'system.super-admin')
				END
			ELSE '["system.super-admin"]'
		END
	ELSE '["system.super-admin"]'
END
WHERE `is_owner` = 1;--> statement-breakpoint
INSERT OR IGNORE INTO `user_roles` (`user_id`, `role_id`)
SELECT `id`, 'system.super-admin'
FROM `users`
WHERE `is_owner` = 1;--> statement-breakpoint
CREATE TABLE `__new_auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`legacy_refresh_token_hash` text,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_auth_sessions` (
	`id`,
	`user_id`,
	`token`,
	`legacy_refresh_token_hash`,
	`expires_at`,
	`ip_address`,
	`user_agent`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`user_id`,
	'legacy:' || `refresh_token_hash`,
	`refresh_token_hash`,
	CASE
		WHEN typeof(`expires_at`) = 'integer' THEN `expires_at`
		ELSE unixepoch(`expires_at`) * 1000
	END,
	`ip`,
	`user_agent`,
	COALESCE(
		CASE
			WHEN typeof(`created_at`) = 'integer' THEN `created_at`
			ELSE unixepoch(`created_at`) * 1000
		END,
		unixepoch() * 1000
	),
	COALESCE(
		CASE
			WHEN typeof(`created_at`) = 'integer' THEN `created_at`
			ELSE unixepoch(`created_at`) * 1000
		END,
		unixepoch() * 1000
	)
FROM `auth_sessions`
WHERE `revoked_at` IS NULL
	AND CASE
		WHEN typeof(`expires_at`) = 'integer' THEN `expires_at`
		ELSE unixepoch(`expires_at`) * 1000
	END > unixepoch() * 1000;--> statement-breakpoint
CREATE TABLE `__migration_0007_auth_login_event_sessions` (
	`event_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL
);--> statement-breakpoint
INSERT INTO `__migration_0007_auth_login_event_sessions` (`event_id`, `session_id`)
SELECT event.`id`, event.`session_id`
FROM `auth_login_events` event
INNER JOIN `__new_auth_sessions` session
	ON session.`id` = event.`session_id`
WHERE event.`session_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `auth_sessions`;--> statement-breakpoint
ALTER TABLE `__new_auth_sessions` RENAME TO `auth_sessions`;--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_unique` ON `auth_sessions` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_legacy_refresh_token_hash_unique` ON `auth_sessions` (`legacy_refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
UPDATE `auth_login_events`
SET `session_id` = (
	SELECT mapping.`session_id`
	FROM `__migration_0007_auth_login_event_sessions` mapping
	WHERE mapping.`event_id` = `auth_login_events`.`id`
)
WHERE EXISTS (
	SELECT 1
	FROM `__migration_0007_auth_login_event_sessions` mapping
	WHERE mapping.`event_id` = `auth_login_events`.`id`
);--> statement-breakpoint
DROP TABLE `__migration_0007_auth_login_event_sessions`;--> statement-breakpoint
CREATE TABLE `__new_auth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`account_id` text NOT NULL,
	`password_hash` text,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`scope` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_auth_accounts` (
	`id`,
	`user_id`,
	`provider_id`,
	`account_id`,
	`password_hash`,
	`access_token`,
	`refresh_token`,
	`id_token`,
	`scope`,
	`access_token_expires_at`,
	`refresh_token_expires_at`,
	`created_at`,
	`updated_at`
)
SELECT
	account.`id`,
	account.`user_id`,
	account.`provider_id`,
	CASE
		WHEN account.`provider_id` = 'credential' THEN account.`user_id`
		ELSE account.`account_id`
	END,
	COALESCE(
		NULLIF(account.`password_hash`, ''),
		(
			SELECT NULLIF(credential.`password_hash`, '')
			FROM `auth_credentials` credential
			INNER JOIN `auth_identities` identity
				ON identity.`id` = credential.`identity_id`
			WHERE identity.`user_id` = account.`user_id`
				AND identity.`provider` = 'local'
				AND credential.`type` = 'password'
			ORDER BY credential.`updated_at` DESC, credential.`id` DESC
			LIMIT 1
		),
		NULLIF((SELECT `password` FROM `users` WHERE `id` = account.`user_id`), '!'),
		NULLIF((SELECT `password_hash` FROM `users` WHERE `id` = account.`user_id`), '')
	),
	account.`access_token`,
	account.`refresh_token`,
	account.`id_token`,
	account.`scope`,
	CASE
		WHEN account.`expires_at` IS NULL THEN NULL
		WHEN typeof(account.`expires_at`) = 'integer' THEN account.`expires_at`
		ELSE unixepoch(account.`expires_at`) * 1000
	END,
	NULL,
	COALESCE(
		CASE
			WHEN typeof(account.`created_at`) = 'integer' THEN account.`created_at`
			ELSE unixepoch(account.`created_at`) * 1000
		END,
		unixepoch() * 1000
	),
	COALESCE(
		CASE
			WHEN typeof(account.`updated_at`) = 'integer' THEN account.`updated_at`
			ELSE unixepoch(account.`updated_at`) * 1000
		END,
		unixepoch() * 1000
	)
FROM `auth_accounts` account
WHERE account.`provider_id` <> 'credential'
	OR account.`id` = (
		SELECT candidate.`id`
		FROM `auth_accounts` candidate
		WHERE candidate.`provider_id` = 'credential'
			AND candidate.`user_id` = account.`user_id`
		ORDER BY candidate.`updated_at` DESC, candidate.`id` DESC
		LIMIT 1
	);--> statement-breakpoint
INSERT INTO `__new_auth_accounts` (
	`id`,
	`user_id`,
	`provider_id`,
	`account_id`,
	`password_hash`,
	`created_at`,
	`updated_at`
)
SELECT
	'authacct_migrated_' || user.`id`,
	user.`id`,
	'credential',
	user.`id`,
	COALESCE(
		(
			SELECT NULLIF(credential.`password_hash`, '')
			FROM `auth_credentials` credential
			INNER JOIN `auth_identities` identity
				ON identity.`id` = credential.`identity_id`
			WHERE identity.`user_id` = user.`id`
				AND identity.`provider` = 'local'
				AND credential.`type` = 'password'
			ORDER BY credential.`updated_at` DESC, credential.`id` DESC
			LIMIT 1
		),
		NULLIF(user.`password`, '!'),
		NULLIF(user.`password_hash`, '')
	),
	unixepoch() * 1000,
	unixepoch() * 1000
FROM `users` user
WHERE NOT EXISTS (
	SELECT 1
	FROM `__new_auth_accounts` account
	WHERE account.`provider_id` = 'credential'
		AND account.`user_id` = user.`id`
)
	AND COALESCE(
		(
			SELECT NULLIF(credential.`password_hash`, '')
			FROM `auth_credentials` credential
			INNER JOIN `auth_identities` identity
				ON identity.`id` = credential.`identity_id`
			WHERE identity.`user_id` = user.`id`
				AND identity.`provider` = 'local'
				AND credential.`type` = 'password'
			ORDER BY credential.`updated_at` DESC, credential.`id` DESC
			LIMIT 1
		),
		NULLIF(user.`password`, '!'),
		NULLIF(user.`password_hash`, '')
	) IS NOT NULL;--> statement-breakpoint
DROP TABLE `auth_accounts`;--> statement-breakpoint
ALTER TABLE `__new_auth_accounts` RENAME TO `auth_accounts`;--> statement-breakpoint
CREATE UNIQUE INDEX `auth_accounts_provider_account_unique` ON `auth_accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `auth_accounts_user_idx` ON `auth_accounts` (`user_id`);--> statement-breakpoint
UPDATE `users` SET `password` = '!';--> statement-breakpoint
CREATE TABLE `__new_auth_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_auth_verifications` (
	`id`,
	`identifier`,
	`value`,
	`expires_at`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`identifier`,
	`value`,
	CASE
		WHEN typeof(`expires_at`) = 'integer' THEN `expires_at`
		ELSE unixepoch(`expires_at`) * 1000
	END,
	COALESCE(
		CASE
			WHEN typeof(`created_at`) = 'integer' THEN `created_at`
			ELSE unixepoch(`created_at`) * 1000
		END,
		unixepoch() * 1000
	),
	COALESCE(
		CASE
			WHEN typeof(`updated_at`) = 'integer' THEN `updated_at`
			ELSE unixepoch(`updated_at`) * 1000
		END,
		unixepoch() * 1000
	)
FROM `auth_verifications`;--> statement-breakpoint
DROP TABLE `auth_verifications`;--> statement-breakpoint
ALTER TABLE `__new_auth_verifications` RENAME TO `auth_verifications`;--> statement-breakpoint
CREATE INDEX `auth_verifications_identifier_idx` ON `auth_verifications` (`identifier`);--> statement-breakpoint
CREATE TABLE `__new_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`key_hash` text,
	`name` text NOT NULL,
	`description` text,
	`permissions` text NOT NULL,
	`allowed_models` text,
	`is_revoked` integer DEFAULT false NOT NULL,
	`created_by` text,
	`revoked_by` text,
	`revoked_at` text,
	`last_used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_api_keys` (
	`id`,
	`key`,
	`key_hash`,
	`name`,
	`description`,
	`permissions`,
	`allowed_models`,
	`is_revoked`,
	`created_by`,
	`revoked_by`,
	`revoked_at`,
	`last_used_at`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`key`,
	`key_hash`,
	`name`,
	`description`,
	`permissions`,
	`allowed_models`,
	`is_revoked`,
	`created_by`,
	`revoked_by`,
	`revoked_at`,
	`last_used_at`,
	`created_at`,
	`updated_at`
FROM `api_keys`;--> statement-breakpoint
DROP TABLE `api_keys`;--> statement-breakpoint
ALTER TABLE `__new_api_keys` RENAME TO `api_keys`;--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_unique` ON `api_keys` (`key`);--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `password_hash`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `display_name`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `locale`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `is_owner`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `last_login_at`;
