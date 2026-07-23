CREATE TABLE IF NOT EXISTS `data_collection_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`station_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`duration_ms` integer,
	`status` text NOT NULL,
	`forecast_collection_id` integer,
	`forecast_successful_models` text NOT NULL,
	`forecast_failed_models` text NOT NULL,
	`observations_received` integer NOT NULL,
	`observations_inserted` integer NOT NULL,
	`observations_updated` integer NOT NULL,
	`error_messages` text NOT NULL,
	FOREIGN KEY (`station_id`) REFERENCES `weather_stations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`forecast_collection_id`) REFERENCES `forecast_collections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `data_collection_runs_station_status_idx` ON `data_collection_runs` (`station_id`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `data_collection_runs_station_started_idx` ON `data_collection_runs` (`station_id`,`started_at`);
