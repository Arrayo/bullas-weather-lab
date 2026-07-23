import { hourlyForecasts, modelRuns } from "./schema.js";
import type { DatabaseExecutor, LocalDatabase, RemoteDatabase } from "./database-types.js";
import type { HourlyForecast } from "../../domain/hourly-forecast.js";

export function createSqliteExecutor(db: LocalDatabase, close: () => void = () => {}): DatabaseExecutor {
  return {
    kind: "sqlite",
    raw: db,
    insertForecastBatch: async (forecasts, originalModel) => {
      db.transaction((tx) => {
        insertForecastBatchSync(tx as LocalDatabase, forecasts, originalModel);
      });
    },
    close,
  };
}

export function createLibsqlExecutor(db: RemoteDatabase, close: () => void | Promise<void> = () => {}): DatabaseExecutor {
  return {
    kind: "libsql",
    raw: asRepositoryDatabase(db),
    insertForecastBatch: async (forecasts, originalModel) => {
      await db.transaction(async (tx) => {
        await insertForecastBatchAsync(asRepositoryDatabase(tx), forecasts, originalModel);
      });
    },
    close,
  };
}

function insertForecastBatchSync(db: LocalDatabase, forecasts: HourlyForecast[], originalModel: string): void {
  const first = forecasts[0];
  if (!first) return;
  db.insert(modelRuns).values(toModelRunInsert(first, originalModel)).run();
  for (const forecast of forecasts) {
    db.insert(hourlyForecasts).values(toForecastInsert(forecast)).onConflictDoUpdate({
      target: [hourlyForecasts.collectionId, hourlyForecasts.stationId, hourlyForecasts.model, hourlyForecasts.validAt],
      set: toForecastUpdate(forecast),
    }).run();
  }
}

async function insertForecastBatchAsync(db: LocalDatabase, forecasts: HourlyForecast[], originalModel: string): Promise<void> {
  const first = forecasts[0];
  if (!first) return;
  await db.insert(modelRuns).values(toModelRunInsert(first, originalModel));
  for (const forecast of forecasts) {
    await db.insert(hourlyForecasts).values(toForecastInsert(forecast)).onConflictDoUpdate({
      target: [hourlyForecasts.collectionId, hourlyForecasts.stationId, hourlyForecasts.model, hourlyForecasts.validAt],
      set: toForecastUpdate(forecast),
    });
  }
}

function toModelRunInsert(forecast: HourlyForecast, originalModel: string) {
  return {
    stationId: forecast.stationId,
    model: forecast.model,
    originalModel,
    modelRunAt: forecast.modelRunAt?.toISOString() ?? null,
    downloadedAt: forecast.downloadedAt.toISOString(),
  };
}

function toForecastInsert(forecast: HourlyForecast) {
  return {
    collectionId: forecast.collectionId,
    stationId: forecast.stationId,
    model: forecast.model,
    modelRunAt: forecast.modelRunAt?.toISOString() ?? null,
    validAt: forecast.validAt.toISOString(),
    downloadedAt: forecast.downloadedAt.toISOString(),
    temperature2m: forecast.temperature2m,
    relativeHumidity2m: forecast.relativeHumidity2m,
    precipitation: forecast.precipitation,
    windSpeed10m: forecast.windSpeed10m,
    windDirection10m: forecast.windDirection10m,
    cloudCover: forecast.cloudCover,
  };
}

function toForecastUpdate(forecast: HourlyForecast) {
  return {
    modelRunAt: forecast.modelRunAt?.toISOString() ?? null,
    downloadedAt: forecast.downloadedAt.toISOString(),
    temperature2m: forecast.temperature2m,
    relativeHumidity2m: forecast.relativeHumidity2m,
    precipitation: forecast.precipitation,
    windSpeed10m: forecast.windSpeed10m,
    windDirection10m: forecast.windDirection10m,
    cloudCover: forecast.cloudCover,
  };
}

function asRepositoryDatabase(db: unknown): LocalDatabase {
  // Drizzle's better-sqlite3 and libSQL builders share the runtime query API used
  // by repositories, but their transaction/result overloads are incompatible at
  // type level. Keep the cast private to this adapter instead of exposing it.
  return db as LocalDatabase;
}
