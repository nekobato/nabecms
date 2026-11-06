CREATE TABLE `idempotency_records` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`operation` text NOT NULL,
	`key_hash` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_body` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_records_principal_operation_key_unique` ON `idempotency_records` (`principal_id`,`operation`,`key_hash`);--> statement-breakpoint
CREATE INDEX `idempotency_records_expires_idx` ON `idempotency_records` (`expires_at`);