CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`key_hash` text,
	`name` text NOT NULL,
	`description` text,
	`permissions` text NOT NULL,
	`allowed_models` text,
	`is_revoked` integer DEFAULT false NOT NULL,
	`last_used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_unique` ON `api_keys` (`key`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`target_table` text NOT NULL,
	`target_id` text NOT NULL,
	`before` text,
	`after` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_target_idx` ON `audit_logs` (`target_table`,`target_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`type` text DEFAULT 'password' NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `auth_identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `auth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`email` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `auth_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role_ids` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_expires_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`sent_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by` text NOT NULL,
	`metadata` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_invites_token_hash_unique` ON `auth_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_invites_email_idx` ON `auth_invites` (`email`);--> statement-breakpoint
CREATE INDEX `auth_invites_status_idx` ON `auth_invites` (`status`);--> statement-breakpoint
CREATE INDEX `auth_invites_expires_idx` ON `auth_invites` (`token_expires_at`);--> statement-breakpoint
CREATE TABLE `auth_login_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text,
	`provider` text NOT NULL,
	`result` text NOT NULL,
	`reason` text,
	`session_id` text,
	`ip` text,
	`user_agent` text,
	`location` text,
	`request_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `auth_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `auth_login_events_created_idx` ON `auth_login_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `auth_login_events_email_idx` ON `auth_login_events` (`email`);--> statement-breakpoint
CREATE INDEX `auth_login_events_user_idx` ON `auth_login_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_login_events_result_idx` ON `auth_login_events` (`result`);--> statement-breakpoint
CREATE INDEX `auth_login_events_reason_idx` ON `auth_login_events` (`reason`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`identity_id` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`user_agent` text,
	`ip` text,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`identity_id`) REFERENCES `auth_identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_draft_revision_id` text,
	`published_revision_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`published_at` text,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entries_model_status_updated_idx` ON `entries` (`model_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `entries_published_at_idx` ON `entries` (`published_at`);--> statement-breakpoint
CREATE INDEX `entries_current_draft_idx` ON `entries` (`current_draft_revision_id`);--> statement-breakpoint
CREATE INDEX `entries_published_revision_idx` ON `entries` (`published_revision_id`);--> statement-breakpoint
CREATE TABLE `entry_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`field_id` text NOT NULL,
	`locale` text NOT NULL,
	`value_string` text,
	`value_number` real,
	`value_date` text,
	`value_boolean` integer,
	`value_json` text,
	`value_media` text,
	`value_relation` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `model_fields`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`locale`) REFERENCES `locales`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_fields_entry_field_locale_unique` ON `entry_fields` (`entry_id`,`field_id`,`locale`);--> statement-breakpoint
CREATE TABLE `entry_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`published_at` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_revisions_entry_revision_unique` ON `entry_revisions` (`entry_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `entry_revisions_entry_status_idx` ON `entry_revisions` (`entry_id`,`status`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `locales` (
	`code` text PRIMARY KEY NOT NULL,
	`is_default` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`url` text NOT NULL,
	`type` text NOT NULL,
	`mime_type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`width` integer,
	`height` integer,
	`size` integer NOT NULL,
	`locale` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`locale`) REFERENCES `locales`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `media_group_locale_idx` ON `media` (`group_id`,`locale`);--> statement-breakpoint
CREATE TABLE `media_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`template_key` text NOT NULL,
	`url` text,
	`width` integer,
	`height` integer,
	`size` integer,
	`mime_type` text,
	`format` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider` text NOT NULL,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_variants_media_template_unique` ON `media_variants` (`media_id`,`template_key`);--> statement-breakpoint
CREATE INDEX `media_variants_status_idx` ON `media_variants` (`status`);--> statement-breakpoint
CREATE INDEX `media_variants_media_id_idx` ON `media_variants` (`media_id`);--> statement-breakpoint
CREATE TABLE `model_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`name` text NOT NULL,
	`field_key` text NOT NULL,
	`type` text NOT NULL,
	`position` integer NOT NULL,
	`required` integer NOT NULL,
	`has_locales` integer NOT NULL,
	`is_unique` integer DEFAULT false NOT NULL,
	`variant` text,
	`options` text,
	`default_value` text,
	`is_private` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_fields_model_id_name_unique` ON `model_fields` (`model_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `model_fields_model_id_field_key_unique` ON `model_fields` (`model_id`,`field_key`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_private` integer DEFAULT false NOT NULL,
	`title_field_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `models_name_unique` ON `models` (`name`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`permissions` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_unique` ON `roles` (`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`display_name` text,
	`locale` text DEFAULT 'ja' NOT NULL,
	`is_owner` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `webhook_delivery_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer NOT NULL,
	`response_code` integer,
	`latency_ms` integer,
	`error` text,
	`payload` text,
	`response_body` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`event` text NOT NULL,
	`url` text NOT NULL,
	`method` text NOT NULL,
	`headers` text,
	`body` text,
	`is_active` integer DEFAULT true NOT NULL,
	`secret` text,
	`event_filters` text,
	`custom_headers` text,
	`timeout_ms` integer,
	`max_retries` integer,
	`backoff_strategy` text,
	`concurrency` integer,
	`status` text,
	`body_template` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
