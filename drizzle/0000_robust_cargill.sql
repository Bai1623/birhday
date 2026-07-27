CREATE TABLE `gifts` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
