import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { collectForecastsForStation } from "../src/application/forecast-use-cases.js";
import type { HourlyForecast } from "../src/domain/hourly-forecast.js";
import type { HourlyObservation } from "../src/domain/hourly-observation.js";
import { createSqliteExecutor } from "../src/infrastructure/database/database-adapter.js";
import { createDb } from "../src/infrastructure/database/db.js";
import { applyMigrationsForTests } from "../src/infrastructure/database/migrate.js";
import { DrizzleForecastRepository, DrizzleHourlyObservationRepository, DrizzleWeatherStationRepository } from "../src/infrastructure/database/repositories.js";
import { forecastCollections } from "../src/infrastructure/database/schema.js";

describe("DrizzleForecastRepository", () => {
  it("devuelve solo la colección más reciente de cada modelo", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "bullas-weather-lab-")), "test.db");
    const db = createDb(dbPath);
    applyMigrationsForTests(db);

    const executor = createSqliteExecutor(db);
    const stations = new DrizzleWeatherStationRepository(executor);
    await stations.saveMany([
      {
        id: "STATION",
        name: "Station",
        province: "Murcia",
        latitude: 38,
        longitude: -1.5,
        elevation: null,
      },
    ]);

    const forecasts = new DrizzleForecastRepository(executor);
    const olderCollectionId = await forecasts.createCollection("STATION", new Date("2026-07-22T00:00:00.000Z"));
    await forecasts.saveForecasts(makeForecasts(olderCollectionId, 20), "gfs_global");
    await forecasts.finishCollection(olderCollectionId, "success", ["gfs_global"], [], new Date("2026-07-22T00:01:00.000Z"));

    const newerCollectionId = await forecasts.createCollection("STATION", new Date("2026-07-22T01:00:00.000Z"));
    await forecasts.saveForecasts(makeForecasts(newerCollectionId, 30), "gfs_global");
    await forecasts.finishCollection(newerCollectionId, "success", ["gfs_global"], [], new Date("2026-07-22T01:01:00.000Z"));

    const rows = await forecasts.listNextHours("STATION", 2);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.collectionId === newerCollectionId)).toBe(true);
    expect(rows.map((row) => row.temperature2m)).toEqual([30, 31]);
  });

  it("cruza predicción y observación exactas y calcula error como predicción menos observación", async () => {
    const { forecasts, observations } = await createRepositories();
    const collectionId = await forecasts.createCollection("STATION", new Date("2026-07-22T01:00:00.000Z"));
    await forecasts.saveForecasts([
      {
        ...makeForecast(collectionId, 30, 0),
        validAt: new Date("2026-07-22T10:00:00.000Z"),
        temperature2m: 31,
        relativeHumidity2m: 40,
        windSpeed10m: 12,
      },
    ], "gfs_global");
    await forecasts.finishCollection(collectionId, "success", ["gfs_global"], [], new Date("2026-07-22T01:01:00.000Z"));
    await observations.saveMany([
      makeObservation("2026-07-22T10:00:00.000Z", { temperature: 30, relativeHumidity: 45, windSpeed: 10 }),
    ]);

    const result = await forecasts.verifyAgainstObservations("STATION", { hours: 24, minimumLeadMinutes: 0 });
    const rows = result.rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.temperatureError).toBe(1);
    expect(rows[0]?.humidityError).toBe(-5);
    expect(rows[0]?.windSpeedError).toBe(2);
  });

  it("descarta forecast descargado después de validAt", async () => {
    const { forecasts, observations } = await createRepositories();
    const collectionId = await forecasts.createCollection("STATION", new Date("2026-07-22T12:00:00.000Z"));
    await forecasts.saveForecasts([
      makeForecastForTime(collectionId, "2026-07-22T10:00:00.000Z", "2026-07-22T11:00:00.000Z", 99),
    ], "gfs_global");
    await observations.saveMany([makeObservation("2026-07-22T10:00:00.000Z", { temperature: 30 })]);

    const result = await forecasts.verifyAgainstObservations("STATION", { hours: 24, minimumLeadMinutes: 0 });

    expect(result.rows).toEqual([]);
    expect(result.discardedAfterValidTimeCount).toBe(1);
  });

  it("descarta forecast que no cumple el margen mínimo", async () => {
    const { forecasts, observations } = await createRepositories();
    const collectionId = await forecasts.createCollection("STATION", new Date("2026-07-22T09:45:00.000Z"));
    await forecasts.saveForecasts([
      makeForecastForTime(collectionId, "2026-07-22T10:00:00.000Z", "2026-07-22T09:45:00.000Z", 99),
    ], "gfs_global");
    await observations.saveMany([makeObservation("2026-07-22T10:00:00.000Z", { temperature: 30 })]);

    const result = await forecasts.verifyAgainstObservations("STATION", { hours: 24, minimumLeadMinutes: 30 });

    expect(result.rows).toEqual([]);
  });

  it("elige la predicción válida más reciente antes de validAt y calcula leadTimeMinutes", async () => {
    const { forecasts, observations } = await createRepositories();
    const older = await forecasts.createCollection("STATION", new Date("2026-07-22T08:00:00.000Z"));
    await forecasts.saveForecasts([makeForecastForTime(older, "2026-07-22T10:00:00.000Z", "2026-07-22T08:00:00.000Z", 20)], "gfs_global");
    await forecasts.finishCollection(older, "success", ["gfs_global"], [], new Date("2026-07-22T08:01:00.000Z"));
    const newer = await forecasts.createCollection("STATION", new Date("2026-07-22T09:20:00.000Z"));
    await forecasts.saveForecasts([makeForecastForTime(newer, "2026-07-22T10:00:00.000Z", "2026-07-22T09:20:00.000Z", 25)], "gfs_global");
    await forecasts.finishCollection(newer, "success", ["gfs_global"], [], new Date("2026-07-22T09:21:00.000Z"));
    await observations.saveMany([makeObservation("2026-07-22T10:00:00.000Z", { temperature: 24 })]);

    const result = await forecasts.verifyAgainstObservations("STATION", { hours: 24, minimumLeadMinutes: 30 });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.forecastCollectionId).toBe(newer);
    expect(result.rows[0]?.forecastTemperature).toBe(25);
    expect(result.rows[0]?.leadTimeMinutes).toBe(40);
  });

  it("no elige simplemente la última colección global si es retrospectiva", async () => {
    const { forecasts, observations } = await createRepositories();
    const valid = await forecasts.createCollection("STATION", new Date("2026-07-22T08:00:00.000Z"));
    await forecasts.saveForecasts([makeForecastForTime(valid, "2026-07-22T10:00:00.000Z", "2026-07-22T08:00:00.000Z", 20)], "gfs_global");
    await forecasts.finishCollection(valid, "success", ["gfs_global"], [], new Date("2026-07-22T08:01:00.000Z"));
    const invalidLatest = await forecasts.createCollection("STATION", new Date("2026-07-22T11:00:00.000Z"));
    await forecasts.saveForecasts([makeForecastForTime(invalidLatest, "2026-07-22T10:00:00.000Z", "2026-07-22T11:00:00.000Z", 99)], "gfs_global");
    await forecasts.finishCollection(invalidLatest, "success", ["gfs_global"], [], new Date("2026-07-22T11:01:00.000Z"));
    await observations.saveMany([makeObservation("2026-07-22T10:00:00.000Z", { temperature: 19 })]);

    const result = await forecasts.verifyAgainstObservations("STATION", { hours: 24, minimumLeadMinutes: 0 });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.forecastCollectionId).toBe(valid);
    expect(result.rows[0]?.temperatureError).toBe(1);
  });

  it("filtra por horizonte mínimo y máximo", async () => {
    const { forecasts, observations } = await createRepositories();
    const collectionId = await forecasts.createCollection("STATION", new Date("2026-07-22T00:00:00.000Z"));
    await forecasts.saveForecasts([
      makeForecastForTime(collectionId, "2026-07-22T10:00:00.000Z", "2026-07-22T04:00:00.000Z", 20),
      makeForecastForTime(collectionId, "2026-07-22T12:00:00.000Z", "2026-07-22T11:00:00.000Z", 30),
    ], "gfs_global");
    await forecasts.finishCollection(collectionId, "success", ["gfs_global"], [], new Date("2026-07-22T00:01:00.000Z"));
    await observations.saveMany([
      makeObservation("2026-07-22T10:00:00.000Z", { temperature: 19 }),
      makeObservation("2026-07-22T12:00:00.000Z", { temperature: 29 }),
    ]);

    const result = await forecasts.verifyAgainstObservations("STATION", { hours: 24, minimumLeadMinutes: 0, minLeadHours: 5, maxLeadHours: 7 });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.leadTimeHours).toBe(6);
  });

  it("usa downloadedAt específico del modelo", async () => {
    const { forecasts, observations } = await createRepositories();
    const collectionId = await forecasts.createCollection("STATION", new Date("2026-07-22T00:00:00.000Z"));
    await forecasts.saveForecasts([
      makeForecastForTime(collectionId, "2026-07-22T10:00:00.000Z", "2026-07-22T09:00:00.000Z", 20, "gfs_global"),
      makeForecastForTime(collectionId, "2026-07-22T10:00:00.000Z", "2026-07-22T11:00:00.000Z", 30, "icon_global"),
    ], "mixed");
    await forecasts.finishCollection(collectionId, "success", ["gfs_global", "icon_global"], [], new Date("2026-07-22T00:01:00.000Z"));
    await observations.saveMany([makeObservation("2026-07-22T10:00:00.000Z", { temperature: 19 })]);

    const result = await forecasts.verifyAgainstObservations("STATION", { hours: 24, minimumLeadMinutes: 0 });

    expect(result.rows.map((row) => row.model)).toEqual(["gfs_global"]);
  });

  it("devuelve vacío si no existen coincidencias exactas", async () => {
    const { forecasts, observations } = await createRepositories();
    const collectionId = await forecasts.createCollection("STATION", new Date("2026-07-22T01:00:00.000Z"));
    await forecasts.saveForecasts([{ ...makeForecast(collectionId, 30, 0), validAt: new Date("2026-07-22T10:00:00.000Z") }], "gfs_global");
    await forecasts.finishCollection(collectionId, "success", ["gfs_global"], [], new Date("2026-07-22T01:01:00.000Z"));
    await observations.saveMany([makeObservation("2026-07-22T11:00:00.000Z", { temperature: 30 })]);

    await expect(forecasts.verifyAgainstObservations("STATION", { hours: 24, minimumLeadMinutes: 0 })).resolves.toMatchObject({ rows: [] });
  });

  it("revierte model_runs y hourly_forecasts si falla una hora a mitad del lote", async () => {
    const db = createDb(join(mkdtempSync(join(tmpdir(), "bullas-weather-lab-")), "test.db"));
    applyMigrationsForTests(db);
    const executor = createSqliteExecutor(db);
    await new DrizzleWeatherStationRepository(executor).saveMany([{ id: "STATION", name: "Station", province: "Murcia", latitude: 38, longitude: -1.5, elevation: null }]);
    const forecasts = new DrizzleForecastRepository(executor);
    const collectionId = await forecasts.createCollection("STATION", new Date("2026-07-22T01:00:00.000Z"));

    await expect(forecasts.saveForecasts([
      makeForecastForTime(collectionId, "2026-07-22T10:00:00.000Z", "2026-07-22T01:00:00.000Z", 30),
      { ...makeForecastForTime(collectionId, "2026-07-22T11:00:00.000Z", "2026-07-22T01:00:00.000Z", 31), stationId: "MISSING" },
    ], "gfs_global")).rejects.toThrow();

    const [modelRunCount] = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM model_runs`);
    const [forecastCount] = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM hourly_forecasts`);
    expect(modelRunCount?.count).toBe(0);
    expect(forecastCount?.count).toBe(0);
  });

  it("marca la colección partial_success cuando un modelo falla al persistir", async () => {
    const db = createDb(join(mkdtempSync(join(tmpdir(), "bullas-weather-lab-")), "test.db"));
    applyMigrationsForTests(db);
    const executor = createSqliteExecutor(db);
    const stations = new DrizzleWeatherStationRepository(executor);
    await stations.saveMany([{ id: "STATION", name: "Station", province: "Murcia", latitude: 38, longitude: -1.5, elevation: null }]);
    const forecasts = new DrizzleForecastRepository(executor);

    const result = await collectForecastsForStation("STATION", ["gfs_global", "icon_global"], stations, {
      async fetchHourlyForecast(_station, model, collectionId) {
        const row = makeForecastForTime(collectionId, model === "gfs_global" ? "2026-07-22T10:00:00.000Z" : "2026-07-22T11:00:00.000Z", "2026-07-22T01:00:00.000Z", 30, model);
        return model === "gfs_global" ? [row] : [{ ...row, stationId: "MISSING" }];
      },
    }, forecasts, new Date("2026-07-22T01:00:00.000Z"));

    const [collection] = await db.select().from(forecastCollections).limit(1);
    const [iconRows] = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM hourly_forecasts WHERE model = 'icon_global'`);
    expect(result.status).toBe("partial_success");
    expect(result.results).toMatchObject([{ model: "gfs_global", status: "success" }, { model: "icon_global", status: "failure", forecastsSaved: 0 }]);
    expect(collection?.status).toBe("partial_success");
    expect(collection?.successfulModels).toBe('["gfs_global"]');
    expect(iconRows?.count).toBe(0);
  });
});

describe("DrizzleHourlyObservationRepository", () => {
  it("guarda observaciones de forma idempotente actualizando valores", async () => {
    const { observations } = await createRepositories();
    const first = await observations.saveMany([makeObservation("2026-07-22T10:00:00.000Z", { temperature: 30 })]);
    const second = await observations.saveMany([makeObservation("2026-07-22T10:00:00.000Z", { temperature: 31 })]);

    const rows = await observations.listLatest("STATION", 24);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.temperature).toBe(31);
    expect(first).toEqual({ received: 1, inserted: 1, updated: 0 });
    expect(second).toEqual({ received: 1, inserted: 0, updated: 1 });
  });

  it("valida humedad fuera de 0-100", async () => {
    const { observations } = await createRepositories();

    await expect(observations.saveMany([makeObservation("2026-07-22T10:00:00.000Z", { relativeHumidity: 101 })])).rejects.toThrow(
      "campo=relativeHumidity valor=101",
    );
  });

  it("valida precipitación negativa", async () => {
    const { observations } = await createRepositories();

    await expect(observations.saveMany([makeObservation("2026-07-22T10:00:00.000Z", { precipitation: -1 })])).rejects.toThrow(
      "campo=precipitation valor=-1",
    );
  });

  it("usa transacción y no deja medio lote si una fila falla", async () => {
    const { observations } = await createRepositories();
    await expect(
      observations.saveMany([
        makeObservation("2026-07-22T10:00:00.000Z", { temperature: 30 }),
        { ...makeObservation("2026-07-22T11:00:00.000Z", { temperature: 31 }), stationId: "MISSING" },
      ]),
    ).rejects.toThrow();

    await expect(observations.listLatest("STATION", 24)).resolves.toEqual([]);
  });
});

async function createRepositories() {
  const dbPath = join(mkdtempSync(join(tmpdir(), "bullas-weather-lab-")), "test.db");
  const db = createDb(dbPath);
  applyMigrationsForTests(db);
  const executor = createSqliteExecutor(db);
  const stations = new DrizzleWeatherStationRepository(executor);
  await stations.saveMany([
    {
      id: "STATION",
      name: "Station",
      province: "Murcia",
      latitude: 38,
      longitude: -1.5,
      elevation: null,
    },
  ]);

  return {
    forecasts: new DrizzleForecastRepository(executor),
    observations: new DrizzleHourlyObservationRepository(executor),
  };
}

function makeForecasts(collectionId: number, startTemperature: number): HourlyForecast[] {
  return [0, 1, 2].map((offset) => makeForecast(collectionId, startTemperature, offset));
}

function makeForecast(collectionId: number, startTemperature: number, offset: number): HourlyForecast {
  return {
    collectionId,
    stationId: "STATION",
    model: "gfs_global",
    modelRunAt: null,
    downloadedAt: new Date("2026-07-22T01:00:00.000Z"),
    validAt: new Date(Date.now() + (offset + 1) * 60 * 60 * 1000),
    temperature2m: startTemperature + offset,
    relativeHumidity2m: 50,
    precipitation: 0,
    windSpeed10m: 10,
    windDirection10m: 180,
    cloudCover: 20,
  };
}

function makeForecastForTime(collectionId: number, validAt: string, downloadedAt: string, temperature: number, model = "gfs_global"): HourlyForecast {
  return {
    ...makeForecast(collectionId, temperature, 0),
    model,
    validAt: new Date(validAt),
    downloadedAt: new Date(downloadedAt),
    temperature2m: temperature,
  };
}

function makeObservation(observedAt: string, values: Partial<HourlyObservation>): HourlyObservation {
  return {
    stationId: "STATION",
    observedAt: new Date(observedAt),
    downloadedAt: new Date("2026-07-22T12:00:00.000Z"),
    temperature: values.temperature ?? null,
    relativeHumidity: values.relativeHumidity ?? null,
    precipitation: values.precipitation ?? null,
    windSpeed: values.windSpeed ?? null,
    windDirection: values.windDirection ?? null,
    windGust: values.windGust ?? null,
    pressure: values.pressure ?? null,
    source: "aemet",
  };
}
