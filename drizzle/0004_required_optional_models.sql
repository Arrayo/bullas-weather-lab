ALTER TABLE `data_collection_runs` ADD `required_models_successful` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `data_collection_runs` ADD `required_models_failed` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `data_collection_runs` ADD `optional_models_successful` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `data_collection_runs` ADD `optional_models_failed` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `data_collection_runs_one_running_per_station_idx` ON `data_collection_runs` (`station_id`) WHERE status = 'running';
