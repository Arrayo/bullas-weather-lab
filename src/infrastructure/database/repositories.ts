import { asc, eq, like, or, sql, type SQLWrapper } from "drizzle-orm";
import { ActiveCollectionRunError, type DataCollectionRun, type DataCollectionStatus } from "../../domain/data-collection-run.js";
import type { CollectionStatus } from "../../domain/forecast-collection.js";
import type { ForecastVerificationOptions, ForecastVerificationResult, ForecastVerificationRow } from "../../domain/forecast-verification.js";
import type { HourlyForecast } from "../../domain/hourly-forecast.js";
import type { HourlyObservation } from "../../domain/hourly-observation.js";
import type { WeatherStation } from "../../domain/weather-station.js";
import type { ForecastRepository, HourlyObservationRepository, ObservationSaveResult, WeatherStationRepository } from "../../application/ports.js";
import type { DatabaseExecutor, LocalDatabase } from "./database-types.js";
import { dataCollectionRuns, forecastCollections, hourlyObservations, weatherStations } from "./schema.js";

export class DrizzleWeatherStationRepository implements WeatherStationRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async saveMany(stations: WeatherStation[]): Promise<void> {
    const updatedAt = new Date().toISOString();
    for (const station of stations) {
      await this.db.raw
        .insert(weatherStations)
        .values({ ...station, updatedAt })
        .onConflictDoUpdate({
          target: weatherStations.id,
          set: {
            name: station.name,
            province: station.province,
            latitude: station.latitude,
            longitude: station.longitude,
            elevation: station.elevation,
            updatedAt,
          },
        });
    }
  }

  async searchCandidates(query: string[]): Promise<WeatherStation[]> {
    const clauses = query.flatMap((term) => [like(weatherStations.name, `%${term}%`), like(weatherStations.province, `%${term}%`)]);
    const rows = await this.db.raw.select().from(weatherStations).where(or(...clauses)).orderBy(asc(weatherStations.province), asc(weatherStations.name));
    return rows.map(toWeatherStation);
  }

  async findById(stationId: string): Promise<WeatherStation | null> {
    const [row] = await this.db.raw.select().from(weatherStations).where(eq(weatherStations.id, stationId)).limit(1);
    return row ? toWeatherStation(row) : null;
  }
}

export class DrizzleForecastRepository implements ForecastRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async createCollection(stationId: string, startedAt: Date): Promise<number> {
    const [row] = await this.db.raw
      .insert(forecastCollections)
      .values({
        stationId,
        startedAt: startedAt.toISOString(),
        finishedAt: null,
        status: "failure",
        successfulModels: "[]",
        failedModels: "[]",
      })
      .returning({ id: forecastCollections.id });

    if (!row) {
      throw new Error("No se pudo crear la colección de predicciones");
    }

    return row.id;
  }

  async finishCollection(
    collectionId: number,
    status: CollectionStatus,
    successfulModels: readonly string[],
    failedModels: readonly string[],
    finishedAt: Date,
  ): Promise<void> {
    await this.db.raw
      .update(forecastCollections)
      .set({
        status,
        successfulModels: JSON.stringify(successfulModels),
        failedModels: JSON.stringify(failedModels),
        finishedAt: finishedAt.toISOString(),
      })
      .where(eq(forecastCollections.id, collectionId));
  }

  async saveForecasts(forecasts: HourlyForecast[], originalModel: string): Promise<void> {
    if (forecasts.length === 0) {
      return;
    }

    const first = forecasts[0];
    if (!first) {
      return;
    }

    await this.db.insertForecastBatch(forecasts, originalModel);
  }

  async listNextHours(stationId: string, hours: number): Promise<HourlyForecast[]> {
    const now = new Date().toISOString();
    const rows = await queryAll<ForecastRow>(this.db.raw, sql`
      WITH latest_model_collections AS (
        SELECT model, collection_id
        FROM (
          SELECT
            hf.model,
            hf.collection_id,
            ROW_NUMBER() OVER (PARTITION BY hf.model ORDER BY fc.started_at DESC, hf.collection_id DESC) AS collection_rank
          FROM hourly_forecasts hf
          INNER JOIN forecast_collections fc ON fc.id = hf.collection_id
          WHERE hf.station_id = ${stationId} AND fc.finished_at IS NOT NULL AND fc.status IN ('success', 'partial_success')
          GROUP BY hf.model, hf.collection_id, fc.started_at
        )
        WHERE collection_rank = 1
      ), ranked_forecasts AS (
        SELECT
          hf.*,
          ROW_NUMBER() OVER (PARTITION BY hf.model ORDER BY hf.valid_at ASC) AS forecast_rank
        FROM hourly_forecasts hf
        INNER JOIN latest_model_collections latest
          ON latest.model = hf.model AND latest.collection_id = hf.collection_id
        WHERE hf.station_id = ${stationId} AND hf.valid_at >= ${now}
      )
      SELECT * FROM ranked_forecasts
      WHERE forecast_rank <= ${hours}
      ORDER BY valid_at ASC, model ASC
    `);

    return rows.map(toHourlyForecastFromRow);
  }

  async verifyAgainstObservations(stationId: string, options: ForecastVerificationOptions): Promise<ForecastVerificationResult> {
    const minLeadMinutes = options.minimumLeadMinutes;
    const minLeadDays = minLeadMinutes / 1440;
    const minLeadFilterMinutes = options.minLeadHours === undefined ? null : options.minLeadHours * 60;
    const maxLeadFilterMinutes = options.maxLeadHours === undefined ? null : options.maxLeadHours * 60;
    const hoursLimit = options.hours ?? null;

    const rows = await queryAll<VerificationSqlRow>(this.db.raw, sql`
      WITH eligible_forecasts AS (
        SELECT * FROM (
          SELECT
            hf.valid_at,
            hf.model,
            hf.collection_id,
            hf.downloaded_at,
            hf.temperature_2m AS forecast_temperature,
            hf.relative_humidity_2m AS forecast_humidity,
            hf.wind_speed_10m AS forecast_wind_speed,
            hf.precipitation AS forecast_precipitation,
            ROUND((julianday(hf.valid_at) - julianday(hf.downloaded_at)) * 1440.0) AS lead_time_minutes,
            ROW_NUMBER() OVER (
              PARTITION BY hf.station_id, hf.model, hf.valid_at
              ORDER BY hf.downloaded_at DESC, hf.collection_id DESC
            ) AS forecast_rank
          FROM hourly_forecasts hf
          INNER JOIN forecast_collections fc ON fc.id = hf.collection_id
          WHERE hf.station_id = ${stationId}
            AND fc.finished_at IS NOT NULL AND fc.status IN ('success', 'partial_success')
            AND julianday(hf.downloaded_at) <= julianday(hf.valid_at) - ${minLeadDays}
            AND (${minLeadFilterMinutes} IS NULL OR ((julianday(hf.valid_at) - julianday(hf.downloaded_at)) * 1440.0) >= ${minLeadFilterMinutes})
            AND (${maxLeadFilterMinutes} IS NULL OR ((julianday(hf.valid_at) - julianday(hf.downloaded_at)) * 1440.0) < ${maxLeadFilterMinutes})
        )
        WHERE forecast_rank = 1
      ), matched AS (
        SELECT
          hf.valid_at,
          hf.model,
          hf.collection_id,
          hf.downloaded_at,
          hf.lead_time_minutes,
          hf.forecast_temperature,
          obs.temperature AS observed_temperature,
          hf.forecast_humidity,
          obs.relative_humidity AS observed_humidity,
          hf.forecast_wind_speed,
          obs.wind_speed AS observed_wind_speed,
          hf.forecast_precipitation,
          obs.precipitation AS observed_precipitation
        FROM eligible_forecasts hf
        INNER JOIN hourly_observations obs
          ON obs.station_id = ${stationId} AND obs.observed_at = hf.valid_at AND obs.source = 'aemet'
        ORDER BY hf.valid_at DESC, hf.model ASC
      ), selected_hours AS (
        SELECT DISTINCT valid_at FROM matched ORDER BY valid_at DESC LIMIT COALESCE(${hoursLimit}, -1)
      )
      SELECT matched.* FROM matched
      INNER JOIN selected_hours ON selected_hours.valid_at = matched.valid_at
      ORDER BY matched.valid_at DESC, matched.model ASC
    `);

    const discardedAfterValidTimeCount = await this.countDiscardedAfterValidTimeForecasts(stationId);
    const discardedBelowMinimumLeadCount = await this.countDiscardedBelowMinimumLeadForecasts(stationId, options.minimumLeadMinutes);

    return { rows: rows.map(toVerificationRow), discardedAfterValidTimeCount, discardedBelowMinimumLeadCount };
  }

  private async countDiscardedAfterValidTimeForecasts(stationId: string): Promise<number> {
    const [row] = await queryAll<{ count: number }>(this.db.raw, sql`
      SELECT COUNT(*) AS count
      FROM hourly_forecasts hf
      INNER JOIN hourly_observations obs
        ON obs.station_id = hf.station_id AND obs.observed_at = hf.valid_at AND obs.source = 'aemet'
      WHERE hf.station_id = ${stationId}
        AND julianday(hf.downloaded_at) > julianday(hf.valid_at)
    `);

    return row?.count ?? 0;
  }

  private async countDiscardedBelowMinimumLeadForecasts(stationId: string, minimumLeadMinutes: number): Promise<number> {
    const minLeadDays = minimumLeadMinutes / 1440;
    const [row] = await queryAll<{ count: number }>(this.db.raw, sql`
      SELECT COUNT(*) AS count
      FROM hourly_forecasts hf
      INNER JOIN hourly_observations obs
        ON obs.station_id = hf.station_id AND obs.observed_at = hf.valid_at AND obs.source = 'aemet'
      WHERE hf.station_id = ${stationId}
        AND julianday(hf.downloaded_at) <= julianday(hf.valid_at)
        AND julianday(hf.downloaded_at) > julianday(hf.valid_at) - ${minLeadDays}
    `);

    return row?.count ?? 0;
  }

  async recoverAbandonedCollections(stationId: string, olderThan: Date): Promise<number> {
    const result = await this.db.raw.run(sql`
      UPDATE forecast_collections
      SET status = 'failure', finished_at = ${new Date().toISOString()}, failed_models = '["abandoned_by_timeout"]'
      WHERE station_id = ${stationId} AND finished_at IS NULL AND started_at < ${olderThan.toISOString()}
    `);
    return getChangedRows(result);
  }
}

export class DrizzleDataCollectionRunRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async start(stationId: string, startedAt: Date, lockTimeoutMinutes: number): Promise<number> {
    const timeoutIso = new Date(startedAt.getTime() - lockTimeoutMinutes * 60_000).toISOString();
    await this.db.raw.run(sql`
      UPDATE data_collection_runs
      SET status = 'failure', finished_at = ${startedAt.toISOString()}, duration_ms = CAST((julianday(${startedAt.toISOString()}) - julianday(started_at)) * 86400000 AS INTEGER), error_messages = '["recovered_by_lock_timeout"]'
      WHERE station_id = ${stationId} AND status = 'running' AND started_at < ${timeoutIso}
    `);

    const [active] = await this.db.raw.select().from(dataCollectionRuns).where(sql`${dataCollectionRuns.stationId} = ${stationId} AND ${dataCollectionRuns.status} = 'running'`).limit(1);
    if (active) {
      throw new ActiveCollectionRunError(toDataCollectionRun(active));
    }

    let row: { id: number } | undefined;
    try {
      const [inserted] = await this.db.raw
        .insert(dataCollectionRuns)
        .values({
          stationId,
          startedAt: startedAt.toISOString(),
          finishedAt: null,
          durationMs: null,
          status: "running",
          forecastCollectionId: null,
          forecastSuccessfulModels: "[]",
          forecastFailedModels: "[]",
          requiredModelsSuccessful: "[]",
          requiredModelsFailed: "[]",
          optionalModelsSuccessful: "[]",
          optionalModelsFailed: "[]",
          observationsReceived: 0,
          observationsInserted: 0,
          observationsUpdated: 0,
          errorMessages: "[]",
        })
        .returning({ id: dataCollectionRuns.id });
      row = inserted;
    } catch (error) {
      const [latest] = await this.db.raw.select().from(dataCollectionRuns).where(sql`${dataCollectionRuns.stationId} = ${stationId} AND ${dataCollectionRuns.status} = 'running'`).limit(1);
      if (latest) throw new ActiveCollectionRunError(toDataCollectionRun(latest));
      throw error;
    }

    if (!row) throw new Error("No se pudo crear data_collection_run");
    return row.id;
  }

  async finish(runId: number, update: { status: Exclude<DataCollectionStatus, "running">; forecastCollectionId: number | null; forecastSuccessfulModels: string[]; forecastFailedModels: string[]; requiredModelsSuccessful?: string[]; requiredModelsFailed?: string[]; optionalModelsSuccessful?: string[]; optionalModelsFailed?: string[]; observationsReceived: number; observationsInserted: number; observationsUpdated: number; errorMessages: string[]; finishedAt: Date }): Promise<void> {
    const [run] = await this.db.raw.select().from(dataCollectionRuns).where(eq(dataCollectionRuns.id, runId)).limit(1);
    const durationMs = run ? update.finishedAt.getTime() - new Date(run.startedAt).getTime() : null;
    await this.db.raw.update(dataCollectionRuns).set({
      status: update.status,
      forecastCollectionId: update.forecastCollectionId,
      forecastSuccessfulModels: JSON.stringify(update.forecastSuccessfulModels),
      forecastFailedModels: JSON.stringify(update.forecastFailedModels),
      requiredModelsSuccessful: JSON.stringify(update.requiredModelsSuccessful ?? update.forecastSuccessfulModels),
      requiredModelsFailed: JSON.stringify(update.requiredModelsFailed ?? []),
      optionalModelsSuccessful: JSON.stringify(update.optionalModelsSuccessful ?? []),
      optionalModelsFailed: JSON.stringify(update.optionalModelsFailed ?? []),
      observationsReceived: update.observationsReceived,
      observationsInserted: update.observationsInserted,
      observationsUpdated: update.observationsUpdated,
      errorMessages: JSON.stringify(update.errorMessages),
      finishedAt: update.finishedAt.toISOString(),
      durationMs,
    }).where(eq(dataCollectionRuns.id, runId));
  }

  async latest(stationId: string): Promise<DataCollectionRun | null> {
    const [row] = await this.db.raw.select().from(dataCollectionRuns).where(eq(dataCollectionRuns.stationId, stationId)).orderBy(sql`${dataCollectionRuns.startedAt} DESC`).limit(1);
    return row ? toDataCollectionRun(row) : null;
  }

  async countRunning(stationId: string): Promise<number> {
    const [row] = await queryAll<{ count: number }>(this.db.raw, sql`SELECT COUNT(*) AS count FROM data_collection_runs WHERE station_id = ${stationId} AND status = 'running'`);
    return row?.count ?? 0;
  }
}

export class DrizzleHourlyObservationRepository implements HourlyObservationRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async saveMany(observations: HourlyObservation[]): Promise<ObservationSaveResult> {
    if (observations.length === 0) {
      return { received: 0, inserted: 0, updated: 0 };
    }

    for (const observation of observations) {
      validateObservation(observation);
    }

    let inserted = 0;
    let updated = 0;

    const saveOne = async (runner: LocalDatabase, observation: HourlyObservation) => {
      const [existing] = await runner.select({ id: hourlyObservations.id }).from(hourlyObservations).where(sql`${hourlyObservations.stationId} = ${observation.stationId} AND ${hourlyObservations.observedAt} = ${observation.observedAt.toISOString()} AND ${hourlyObservations.source} = ${observation.source}`).limit(1);
      await runner.insert(hourlyObservations).values(toObservationInsert(observation)).onConflictDoUpdate({
        target: [hourlyObservations.stationId, hourlyObservations.observedAt, hourlyObservations.source],
        set: {
          downloadedAt: observation.downloadedAt.toISOString(),
          temperature: observation.temperature,
          relativeHumidity: observation.relativeHumidity,
          precipitation: observation.precipitation,
          windSpeed: observation.windSpeed,
          windDirection: observation.windDirection,
          windGust: observation.windGust,
          pressure: observation.pressure,
        },
      });
      if (existing) updated += 1;
      else inserted += 1;
    };

    if (this.db.kind === "sqlite") {
      this.db.raw.transaction((tx) => {
        for (const observation of observations) {
          const [existing] = tx.select({ id: hourlyObservations.id }).from(hourlyObservations).where(sql`${hourlyObservations.stationId} = ${observation.stationId} AND ${hourlyObservations.observedAt} = ${observation.observedAt.toISOString()} AND ${hourlyObservations.source} = ${observation.source}`).limit(1).all();
          tx.insert(hourlyObservations).values(toObservationInsert(observation)).onConflictDoUpdate({
            target: [hourlyObservations.stationId, hourlyObservations.observedAt, hourlyObservations.source],
            set: {
              downloadedAt: observation.downloadedAt.toISOString(),
              temperature: observation.temperature,
              relativeHumidity: observation.relativeHumidity,
              precipitation: observation.precipitation,
              windSpeed: observation.windSpeed,
              windDirection: observation.windDirection,
              windGust: observation.windGust,
              pressure: observation.pressure,
            },
          }).run();
          if (existing) updated += 1;
          else inserted += 1;
        }
      });
    } else {
      await this.db.raw.transaction(async (tx) => {
        for (const observation of observations) {
          await saveOne(tx, observation);
        }
      });
    }

    return { received: observations.length, inserted, updated };
  }

  async listLatest(stationId: string, limit: number): Promise<HourlyObservation[]> {
    const rows = await this.db.raw.select().from(hourlyObservations).where(eq(hourlyObservations.stationId, stationId)).orderBy(sql`${hourlyObservations.observedAt} DESC`).limit(limit);
    return rows.map(toHourlyObservation);
  }
}

function toWeatherStation(row: typeof weatherStations.$inferSelect): WeatherStation {
  return {
    id: row.id,
    name: row.name,
    province: row.province,
    latitude: row.latitude,
    longitude: row.longitude,
    elevation: row.elevation,
  };
}

interface ForecastRow {
  id: number;
  collection_id: number;
  station_id: string;
  model: string;
  model_run_at: string | null;
  valid_at: string;
  downloaded_at: string;
  temperature_2m: number | null;
  relative_humidity_2m: number | null;
  precipitation: number | null;
  wind_speed_10m: number | null;
  wind_direction_10m: number | null;
  cloud_cover: number | null;
}

interface VerificationSqlRow {
  valid_at: string;
  model: string;
  collection_id: number;
  downloaded_at: string;
  lead_time_minutes: number;
  forecast_temperature: number | null;
  observed_temperature: number | null;
  forecast_humidity: number | null;
  observed_humidity: number | null;
  forecast_wind_speed: number | null;
  observed_wind_speed: number | null;
  forecast_precipitation: number | null;
  observed_precipitation: number | null;
}

function toHourlyForecastFromRow(row: ForecastRow): HourlyForecast {
  return {
    collectionId: row.collection_id,
    stationId: row.station_id,
    model: row.model,
    modelRunAt: row.model_run_at ? new Date(row.model_run_at) : null,
    downloadedAt: new Date(row.downloaded_at),
    validAt: new Date(row.valid_at),
    temperature2m: row.temperature_2m,
    relativeHumidity2m: row.relative_humidity_2m,
    precipitation: row.precipitation,
    windSpeed10m: row.wind_speed_10m,
    windDirection10m: row.wind_direction_10m,
    cloudCover: row.cloud_cover,
  };
}

function toObservationInsert(observation: HourlyObservation): typeof hourlyObservations.$inferInsert {
  return {
    stationId: observation.stationId,
    observedAt: observation.observedAt.toISOString(),
    downloadedAt: observation.downloadedAt.toISOString(),
    temperature: observation.temperature,
    relativeHumidity: observation.relativeHumidity,
    precipitation: observation.precipitation,
    windSpeed: observation.windSpeed,
    windDirection: observation.windDirection,
    windGust: observation.windGust,
    pressure: observation.pressure,
    source: observation.source,
  };
}

function toHourlyObservation(row: typeof hourlyObservations.$inferSelect): HourlyObservation {
  return {
    stationId: row.stationId,
    observedAt: new Date(row.observedAt),
    downloadedAt: new Date(row.downloadedAt),
    temperature: row.temperature,
    relativeHumidity: row.relativeHumidity,
    precipitation: row.precipitation,
    windSpeed: row.windSpeed,
    windDirection: row.windDirection,
    windGust: row.windGust,
    pressure: row.pressure,
    source: row.source,
  };
}

function toVerificationRow(row: VerificationSqlRow): ForecastVerificationRow {
  const leadTimeMinutes = Math.max(0, row.lead_time_minutes);
  return {
    hourUtc: new Date(row.valid_at),
    model: row.model,
    leadTimeMinutes,
    leadTimeHours: leadTimeMinutes / 60,
    forecastDownloadedAt: new Date(row.downloaded_at),
    forecastCollectionId: row.collection_id,
    forecastTemperature: row.forecast_temperature,
    observedTemperature: row.observed_temperature,
    temperatureError: nullableDifference(row.forecast_temperature, row.observed_temperature),
    forecastHumidity: row.forecast_humidity,
    observedHumidity: row.observed_humidity,
    humidityError: nullableDifference(row.forecast_humidity, row.observed_humidity),
    forecastWindSpeed: row.forecast_wind_speed,
    observedWindSpeed: row.observed_wind_speed,
    windSpeedError: nullableDifference(row.forecast_wind_speed, row.observed_wind_speed),
    forecastPrecipitation: row.forecast_precipitation,
    observedPrecipitation: row.observed_precipitation,
    precipitationError: nullableDifference(row.forecast_precipitation, row.observed_precipitation),
  };
}

function toDataCollectionRun(row: typeof dataCollectionRuns.$inferSelect): DataCollectionRun {
  return {
    id: row.id,
    stationId: row.stationId,
    startedAt: new Date(row.startedAt),
    finishedAt: row.finishedAt ? new Date(row.finishedAt) : null,
    durationMs: row.durationMs,
    status: row.status,
    forecastCollectionId: row.forecastCollectionId,
    forecastSuccessfulModels: parseJsonArray(row.forecastSuccessfulModels),
    forecastFailedModels: parseJsonArray(row.forecastFailedModels),
    requiredModelsSuccessful: parseJsonArray(row.requiredModelsSuccessful),
    requiredModelsFailed: parseJsonArray(row.requiredModelsFailed),
    optionalModelsSuccessful: parseJsonArray(row.optionalModelsSuccessful),
    optionalModelsFailed: parseJsonArray(row.optionalModelsFailed),
    observationsReceived: row.observationsReceived,
    observationsInserted: row.observationsInserted,
    observationsUpdated: row.observationsUpdated,
    errorMessages: parseJsonArray(row.errorMessages),
  };
}

function parseJsonArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`JSON array inválido en data_collection_runs: ${value}`);
  }
  return parsed;
}

function validateObservation(observation: HourlyObservation): void {
  assertRange(observation, "temperature", observation.temperature, -60, 60);
  assertRange(observation, "relativeHumidity", observation.relativeHumidity, 0, 100);
  assertRange(observation, "windDirection", observation.windDirection, 0, 360);
  assertMinimum(observation, "windSpeed", observation.windSpeed, 0);
  assertMinimum(observation, "windGust", observation.windGust, 0);
  assertMinimum(observation, "precipitation", observation.precipitation, 0);
}

function assertRange(observation: HourlyObservation, field: string, value: number | null, min: number, max: number): void {
  if (value !== null && (value < min || value > max)) {
    throwInvalidObservation(observation, field, value);
  }
}

function assertMinimum(observation: HourlyObservation, field: string, value: number | null, min: number): void {
  if (value !== null && value < min) {
    throwInvalidObservation(observation, field, value);
  }
}

function throwInvalidObservation(observation: HourlyObservation, field: string, value: number): never {
  throw new Error(`Observación inválida stationId=${observation.stationId} observedAt=${observation.observedAt.toISOString()} campo=${field} valor=${value}`);
}

function nullableDifference(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left - right;
}

export async function saveJobExecution(db: DatabaseExecutor, jobName: string, startedAt: Date, status: CollectionStatus, message?: string): Promise<void> {
  await db.raw.run(sql`INSERT INTO job_executions (job_name, started_at, finished_at, status, message)
    VALUES (${jobName}, ${startedAt.toISOString()}, ${new Date().toISOString()}, ${status}, ${message ?? null})`);
}

async function queryAll<T>(db: LocalDatabase, query: SQLWrapper): Promise<T[]> {
  return await db.all(query) as T[];
}

function getChangedRows(result: unknown): number {
  const row = result as { changes?: number; rowsAffected?: number };
  return row.changes ?? row.rowsAffected ?? 0;
}
