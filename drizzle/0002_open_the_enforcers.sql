CREATE INDEX IF NOT EXISTS `forecast_collections_station_started_at_idx` ON `forecast_collections` (`station_id`,`started_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `hourly_forecasts_station_model_valid_downloaded_idx` ON `hourly_forecasts` (`station_id`,`model`,`valid_at`,`downloaded_at`);
