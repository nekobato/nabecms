CREATE TABLE `log_cleanup_state` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`lease_expires_at` text NOT NULL,
	`finished_at` text,
	`last_success_at` text,
	`cutoff` text,
	`audit_deleted` integer DEFAULT 0 NOT NULL,
	`auth_deleted` integer DEFAULT 0 NOT NULL,
	`remaining` integer,
	`error_code` text
);
--> statement-breakpoint
CREATE INDEX `audit_logs_cleanup_idx` ON `audit_logs` (julianday("created_at"),`id`);--> statement-breakpoint
CREATE INDEX `auth_login_events_cleanup_idx` ON `auth_login_events` (julianday("created_at"),`id`);