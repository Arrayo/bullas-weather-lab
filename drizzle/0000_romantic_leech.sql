CREATE TABLE `forecast_collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`station_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`successful_models` text NOT NULL,
	`failed_models` text NOT NULL,
	FOREIGN KEY (`station_id`) REFERENCES `weather_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hourly_forecasts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection_id` integer NOT NULL,
	`station_id` text NOT NULL,
	`model` text NOT NULL,
	`model_run_at` text,
	`valid_at` text NOT NULL,
	`downloaded_at` text NOT NULL,
	`temperature_2m` real,
	`relative_humidity_2m` real,
	`precipitation` real,
	`wind_speed_10m` real,
	`wind_direction_10m` real,
	`cloud_cover` real,
	FOREIGN KEY (`collection_id`) REFERENCES `forecast_collections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`station_id`) REFERENCES `weather_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hourly_forecasts_unique` ON `hourly_forecasts` (`collection_id`,`station_id`,`model`,`valid_at`);--> statement-breakpoint
CREATE TABLE `job_executions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_name` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`message` text
);
--> statement-breakpoint
CREATE TABLE `model_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`station_id` text NOT NULL,
	`model` text NOT NULL,
	`original_model` text NOT NULL,
	`model_run_at` text,
	`downloaded_at` text NOT NULL,
	FOREIGN KEY (`station_id`) REFERENCES `weather_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `weather_stations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`province` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`elevation` real,
	`updated_at` text NOT NULL
);
