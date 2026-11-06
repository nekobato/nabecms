PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_media` (
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
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_media`("id", "group_id", "url", "type", "mime_type", "name", "description", "width", "height", "size", "status", "created_at", "updated_at", "updated_by") SELECT "id", "group_id", "url", "type", "mime_type", "name", "description", "width", "height", "size", "status", "created_at", "updated_at", "updated_by" FROM `media`;--> statement-breakpoint
DROP TABLE `media`;--> statement-breakpoint
ALTER TABLE `__new_media` RENAME TO `media`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `media_group_idx` ON `media` (`group_id`);