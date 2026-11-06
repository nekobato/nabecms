ALTER TABLE `api_keys` ADD `created_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `api_keys` ADD `revoked_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `api_keys` ADD `revoked_at` text;
