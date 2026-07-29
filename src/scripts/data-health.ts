import { sql } from "drizzle-orm";
import { createApp, hasJsonFlag, queryAll, readStationIdFromArgs, writeJson } from "./common.js";

const args = process.argv.slice(2);
const json = hasJsonFlag(args);
const stationId = readStationIdFromArgs(args);
if (!stationId) {
  console.error("Uso: pnpm data:health --station=<indicativo> [--json]");
  process.exit(1);
}

const app = await createApp();
const station = await app.stationRepository.findById(stationId);
if (!station) {
  console.error(`No existe la estación ${stationId}. Ejecuta primero: pnpm station:find`);
  process.exit(1);
}

const now = new Date();
const latestRun = await app.dataCollectionRepository.latest(station.id);
const [forecastInfo] = await queryAll<{ latest_downloaded_at: string | null; count: number }>(
  app.db,
  sql`SELECT MAX(downloaded_at) AS latest_downloaded_at, COUNT(*) AS count FROM hourly_forecasts WHERE station_id = ${station.id}`,
);
const [obsInfo] = await queryAll<{ latest_observed_at: string | null; count: number }>(
  app.db,
  sql`SELECT MAX(observed_at) AS latest_observed_at, COUNT(*) AS count FROM hourly_observations WHERE station_id = ${station.id}`,
);
const [abandonedForecasts] = await queryAll<{ count: number }>(
  app.db,
  sql`SELECT COUNT(*) AS count FROM forecast_collections WHERE station_id = ${station.id} AND finished_at IS NULL`,
);
const abandonedRuns = await app.dataCollectionRepository.countRunning(station.id);

const forecastAgeHours = forecastInfo?.latest_downloaded_at
  ? (now.getTime() - new Date(forecastInfo.latest_downloaded_at).getTime()) / 3_600_000
  : null;
const observationAgeHours = obsInfo?.latest_observed_at
  ? (now.getTime() - new Date(obsInfo.latest_observed_at).getTime()) / 3_600_000
  : null;
const latestRunAgeHours = latestRun ? (now.getTime() - latestRun.startedAt.getTime()) / 3_600_000 : null;

const hasUsableData = (forecastInfo?.count ?? 0) > 0 && (obsInfo?.count ?? 0) > 0;
const stale =
  forecastAgeHours === null ||
  observationAgeHours === null ||
  forecastAgeHours > app.config.FORECAST_STALE_AFTER_HOURS ||
  observationAgeHours > app.config.OBSERVATION_STALE_AFTER_HOURS;
const failed = !hasUsableData || latestRun?.status === "failure";
const degraded =
  (latestRun?.requiredModelsFailed.length ?? 0) > 0 ||
  abandonedRuns > 0 ||
  (abandonedForecasts?.count ?? 0) > 0;
const status = failed ? "failure" : stale ? "stale" : degraded ? "degraded" : "healthy";

const output = {
  schemaVersion: 1,
  station: station.id,
  status,
  latestRun: latestRun
    ? {
        id: latestRun.id,
        status: latestRun.status,
        startedAt: latestRun.startedAt.toISOString(),
        finishedAt: latestRun.finishedAt?.toISOString() ?? null,
        ageHours: latestRunAgeHours,
      }
    : null,
  latestForecastDownloadedAt: forecastInfo?.latest_downloaded_at ?? null,
  forecastAgeHours,
  forecastCount: forecastInfo?.count ?? 0,
  successfulModels: latestRun?.forecastSuccessfulModels ?? [],
  failedModels: latestRun?.forecastFailedModels ?? [],
  requiredModelsSuccessful: latestRun?.requiredModelsSuccessful ?? [],
  requiredModelsFailed: latestRun?.requiredModelsFailed ?? [],
  optionalModelsSuccessful: latestRun?.optionalModelsSuccessful ?? [],
  optionalModelsFailed: latestRun?.optionalModelsFailed ?? [],
  latestObservationAt: obsInfo?.latest_observed_at ?? null,
  observationAgeHours,
  observationCount: obsInfo?.count ?? 0,
  abandonedForecastCollections: abandonedForecasts?.count ?? 0,
  abandonedGlobalRuns: abandonedRuns,
};

if (json) writeJson(output);
else {
  console.log(`Estado: ${status}`);
  console.log(`Estación: ${station.id} (${station.name})`);
  console.log(`Última ronda global: ${output.latestRun?.id ?? "ninguna"}`);
  console.log(`Estado de la última ronda: ${output.latestRun?.status ?? "ninguna"}`);
  console.log(`Antigüedad de la última ronda (h): ${latestRunAgeHours?.toFixed(2) ?? "n/a"}`);
  console.log(`Última colección de forecasts: ${latestRun?.forecastCollectionId ?? "ninguna"}`);
  console.log(`Modelos correctos: ${output.successfulModels.join(", ") || "ninguno"}`);
  console.log(`Modelos fallidos: ${output.failedModels.join(", ") || "ninguno"}`);
  if (output.optionalModelsFailed.length > 0) {
    console.log(`Optional model unavailable: ${output.optionalModelsFailed.join(", ")}`);
  }
  console.log(`Última observación AEMET: ${output.latestObservationAt ?? "ninguna"}`);
  console.log(`Antigüedad de la última observación (h): ${observationAgeHours?.toFixed(2) ?? "n/a"}`);
  console.log(`Forecasts almacenados: ${output.forecastCount}`);
  console.log(`Observaciones almacenadas: ${output.observationCount}`);
  console.log(`Colecciones abandonadas: ${output.abandonedForecastCollections}`);
  console.log(`Ejecuciones globales abandonadas: ${output.abandonedGlobalRuns}`);
}

process.exitCode = status === "healthy" ? 0 : status === "degraded" ? 2 : status === "stale" ? 4 : 1;
