CREATE TABLE `__new_auth_login_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`provider` text NOT NULL,
	`result` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_auth_login_events`("id", "user_id", "provider", "result", "reason", "created_at") SELECT "id", "user_id", "provider", "result", "reason", "created_at" FROM `auth_login_events`;--> statement-breakpoint
DROP TABLE `auth_login_events`;--> statement-breakpoint
ALTER TABLE `__new_auth_login_events` RENAME TO `auth_login_events`;--> statement-breakpoint
CREATE INDEX `auth_login_events_created_idx` ON `auth_login_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `auth_login_events_user_idx` ON `auth_login_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_login_events_result_idx` ON `auth_login_events` (`result`);--> statement-breakpoint
CREATE INDEX `auth_login_events_reason_idx` ON `auth_login_events` (`reason`);
--> statement-breakpoint
-- Historical payloads are deliberately discarded; content remains in revisions.
UPDATE `audit_logs` SET `before` = NULL, `after` = NULL;
