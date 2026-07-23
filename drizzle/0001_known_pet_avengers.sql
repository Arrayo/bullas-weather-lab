CREATE TABLE IF NOT EXISTS `hourly_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`station_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`downloaded_at` text NOT NULL,
	`temperature` real,
	`relative_humidity` real,
	`precipitation` real,
	`wind_speed` real,
	`wind_direction` real,
	`wind_gust` real,
	`pressure` real,
	`source` text NOT NULL,
	FOREIGN KEY (`station_id`) REFERENCES `weather_stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `hourly_observations_unique` ON `hourly_observations` (`station_id`,`observed_at`,`source`);
