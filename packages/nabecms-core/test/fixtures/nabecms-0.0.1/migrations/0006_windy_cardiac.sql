CREATE TABLE `scheduled_publication_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`revision_id` text,
	`action` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`scheduled_at` text NOT NULL,
	`requested_by` text NOT NULL,
	`locked_at` text,
	`executed_at` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `entry_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scheduled_publication_due_idx` ON `scheduled_publication_actions` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `scheduled_publication_entry_idx` ON `scheduled_publication_actions` (`entry_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `scheduled_publication_revision_idx` ON `scheduled_publication_actions` (`revision_id`);