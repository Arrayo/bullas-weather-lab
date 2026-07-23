import type { HourlyForecast } from "../domain/hourly-forecast.js";
import type { CollectionStatus } from "../domain/forecast-collection.js";
import type { ForecastVerificationOptions, ForecastVerificationResult } from "../domain/forecast-verification.js";
import type { WeatherStation } from "../domain/weather-station.js";
import type { HourlyObservation } from "../domain/hourly-observation.js";

export interface WeatherStationInventorySource {
  fetchStations(): Promise<WeatherStation[]>;
}

export interface WeatherStationRepository {
  saveMany(stations: WeatherStation[]): Promise<void>;
  searchCandidates(query: string[]): Promise<WeatherStation[]>;
  findById(stationId: string): Promise<WeatherStation | null>;
}

export interface ForecastSource {
  fetchHourlyForecast(station: WeatherStation, model: string, collectionId: number, downloadedAt: Date): Promise<HourlyForecast[]>;
}

export interface ForecastRepository {
  createCollection(stationId: string, startedAt: Date): Promise<number>;
  finishCollection(collectionId: number, status: CollectionStatus, successfulModels: readonly string[], failedModels: readonly string[], finishedAt: Date): Promise<void>;
  saveForecasts(forecasts: HourlyForecast[], originalModel: string): Promise<void>;
  listNextHours(stationId: string, hours: number): Promise<HourlyForecast[]>;
  verifyAgainstObservations(stationId: string, options: ForecastVerificationOptions): Promise<ForecastVerificationResult>;
}

export interface HourlyObservationSource {
  fetchLatestObservations(stationId: string, downloadedAt: Date): Promise<HourlyObservation[]>;
}

export interface HourlyObservationRepository {
  saveMany(observations: HourlyObservation[]): Promise<ObservationSaveResult>;
  listLatest(stationId: string, limit: number): Promise<HourlyObservation[]>;
}

export interface ObservationSaveResult {
  received: number;
  inserted: number;
  updated: number;
}
