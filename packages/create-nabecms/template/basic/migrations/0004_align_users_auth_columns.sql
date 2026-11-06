ALTER TABLE `users` ADD `password` text NOT NULL DEFAULT '!';--> statement-breakpoint
ALTER TABLE `users` ADD `name` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `users` ADD `role_id` text NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `users` ADD `ui_preferences` text DEFAULT 'null';--> statement-breakpoint
UPDATE `users`
SET `password` = COALESCE(`password_hash`, `password`, '!')
WHERE `password` = '!' OR `password` = '';--> statement-breakpoint
UPDATE `users`
SET `name` = COALESCE(`display_name`, `email`, `name`)
WHERE `name` = '';--> statement-breakpoint
INSERT OR IGNORE INTO `roles` (`id`, `name`, `description`, `permissions`, `is_system`)
SELECT 'system.super-admin', 'Super Admin', 'System reserved role with full privileges', '{"allow":["*"]}', true
WHERE EXISTS (SELECT 1 FROM `users` WHERE `is_owner` = 1);--> statement-breakpoint
UPDATE `users`
SET `role_id` = '["system.super-admin"]'
WHERE `is_owner` = 1 AND `role_id` = '[]';--> statement-breakpoint
INSERT OR IGNORE INTO `user_roles` (`user_id`, `role_id`)
SELECT `id`, 'system.super-admin'
FROM `users`
WHERE `role_id` = '["system.super-admin"]';
