import type { CollectionStatus, ForecastCollectionResult, ModelCollectionResult } from "../domain/forecast-collection.js";
import type { ForecastRepository, ForecastSource, WeatherStationRepository } from "./ports.js";

export class StationNotFoundError extends Error {
  constructor(stationId: string) {
    super(`No existe la estación ${stationId} en la base de datos. Ejecuta primero: pnpm station:find`);
    this.name = "StationNotFoundError";
  }
}

export async function collectForecastsForStation(
  stationId: string,
  models: readonly string[],
  stationRepository: WeatherStationRepository,
  forecastSource: ForecastSource,
  forecastRepository: ForecastRepository,
  startedAt = new Date(),
): Promise<ForecastCollectionResult> {
  const station = await stationRepository.findById(stationId);
  if (!station) {
    throw new StationNotFoundError(stationId);
  }

  const collectionId = await forecastRepository.createCollection(station.id, startedAt);
  const results: ModelCollectionResult[] = [];

  for (const model of models) {
    try {
      const downloadedAt = new Date();
      const forecasts = await forecastSource.fetchHourlyForecast(station, model, collectionId, downloadedAt);
      assertHasUsefulForecastData(model, forecasts);
      await forecastRepository.saveForecasts(forecasts, model);
      results.push({ model, status: "success", forecastsSaved: forecasts.length });
    } catch (error) {
      results.push({
        model,
        status: "failure",
        forecastsSaved: 0,
        errorMessage: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }

  const successfulModels = results.filter((result) => result.status === "success").map((result) => result.model);
  const failedModels = results.filter((result) => result.status === "failure").map((result) => result.model);
  const status = collectionStatus(successfulModels.length, failedModels.length);
  await forecastRepository.finishCollection(collectionId, status, successfulModels, failedModels, new Date());

  return { collectionId, stationId: station.id, status, results };
}

export function assertHasUsefulForecastData(model: string, forecasts: readonly { temperature2m: number | null; relativeHumidity2m: number | null; precipitation: number | null; windSpeed10m: number | null; windDirection10m: number | null; cloudCover: number | null }[]): void {
  const hasUsefulData = forecasts.some((forecast) =>
    forecast.temperature2m !== null ||
    forecast.relativeHumidity2m !== null ||
    forecast.precipitation !== null ||
    forecast.windSpeed10m !== null ||
    forecast.windDirection10m !== null ||
    forecast.cloudCover !== null,
  );

  if (!hasUsefulData) {
    throw new Error(`El modelo ${model} no devolvió ninguna variable meteorológica utilizable`);
  }
}

function collectionStatus(successCount: number, failureCount: number): CollectionStatus {
  if (successCount > 0 && failureCount === 0) {
    return "success";
  }

  if (successCount > 0) {
    return "partial_success";
  }

  return "failure";
}
