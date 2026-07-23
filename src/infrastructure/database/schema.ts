import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const weatherStations = sqliteTable("weather_stations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  province: text("province").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  elevation: real("elevation"),
  updatedAt: text("updated_at").notNull(),
});

export const modelRuns = sqliteTable("model_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stationId: text("station_id").notNull().references(() => weatherStations.id),
  model: text("model").notNull(),
  originalModel: text("original_model").notNull(),
  modelRunAt: text("model_run_at"),
  downloadedAt: text("downloaded_at").notNull(),
});

export const forecastCollections = sqliteTable(
  "forecast_collections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    stationId: text("station_id").notNull().references(() => weatherStations.id),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    status: text("status", { enum: ["success", "partial_success", "failure"] }).notNull(),
    successfulModels: text("successful_models").notNull(),
    failedModels: text("failed_models").notNull(),
  },
  (table) => ({
    stationStartedAtIdx: index("forecast_collections_station_started_at_idx").on(table.stationId, table.startedAt),
  }),
);

export const hourlyForecasts = sqliteTable(
  "hourly_forecasts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    collectionId: integer("collection_id").notNull().references(() => forecastCollections.id),
    stationId: text("station_id").notNull().references(() => weatherStations.id),
    model: text("model").notNull(),
    modelRunAt: text("model_run_at"),
    validAt: text("valid_at").notNull(),
    downloadedAt: text("downloaded_at").notNull(),
    temperature2m: real("temperature_2m"),
    relativeHumidity2m: real("relative_humidity_2m"),
    precipitation: real("precipitation"),
    windSpeed10m: real("wind_speed_10m"),
    windDirection10m: real("wind_direction_10m"),
    cloudCover: real("cloud_cover"),
  },
  (table) => ({
    forecastUnique: uniqueIndex("hourly_forecasts_unique").on(table.collectionId, table.stationId, table.model, table.validAt),
    stationModelValidDownloadedIdx: index("hourly_forecasts_station_model_valid_downloaded_idx").on(table.stationId, table.model, table.validAt, table.downloadedAt),
  }),
);

export const hourlyObservations = sqliteTable(
  "hourly_observations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    stationId: text("station_id").notNull().references(() => weatherStations.id),
    observedAt: text("observed_at").notNull(),
    downloadedAt: text("downloaded_at").notNull(),
    temperature: real("temperature"),
    relativeHumidity: real("relative_humidity"),
    precipitation: real("precipitation"),
    windSpeed: real("wind_speed"),
    windDirection: real("wind_direction"),
    windGust: real("wind_gust"),
    pressure: real("pressure"),
    source: text("source", { enum: ["aemet"] }).notNull(),
  },
  (table) => ({
    observationUnique: uniqueIndex("hourly_observations_unique").on(table.stationId, table.observedAt, table.source),
  }),
);

export const jobExecutions = sqliteTable("job_executions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobName: text("job_name").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status", { enum: ["success", "partial_success", "failure"] }).notNull(),
  message: text("message"),
});

export const dataCollectionRuns = sqliteTable(
  "data_collection_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    stationId: text("station_id").notNull().references(() => weatherStations.id),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    durationMs: integer("duration_ms"),
    status: text("status", { enum: ["running", "success", "partial_success", "failure"] }).notNull(),
    forecastCollectionId: integer("forecast_collection_id").references(() => forecastCollections.id),
    forecastSuccessfulModels: text("forecast_successful_models").notNull(),
    forecastFailedModels: text("forecast_failed_models").notNull(),
    requiredModelsSuccessful: text("required_models_successful").notNull(),
    requiredModelsFailed: text("required_models_failed").notNull(),
    optionalModelsSuccessful: text("optional_models_successful").notNull(),
    optionalModelsFailed: text("optional_models_failed").notNull(),
    observationsReceived: integer("observations_received").notNull(),
    observationsInserted: integer("observations_inserted").notNull(),
    observationsUpdated: integer("observations_updated").notNull(),
    errorMessages: text("error_messages").notNull(),
  },
  (table) => ({
    stationStatusIdx: index("data_collection_runs_station_status_idx").on(table.stationId, table.status),
    stationStartedIdx: index("data_collection_runs_station_started_idx").on(table.stationId, table.startedAt),
    oneRunningPerStationIdx: uniqueIndex("data_collection_runs_one_running_per_station_idx").on(table.stationId).where(sql`status = 'running'`),
  }),
);
