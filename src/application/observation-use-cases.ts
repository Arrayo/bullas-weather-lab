import type { HourlyObservationRepository, HourlyObservationSource, WeatherStationRepository } from "./ports.js";
import { StationNotFoundError } from "./forecast-use-cases.js";

export interface ObservationCollectionResult {
  stationId: string;
  received: number;
  inserted: number;
  updated: number;
  from: Date;
  to: Date;
}

export async function collectLatestObservations(
  stationId: string,
  stationRepository: WeatherStationRepository,
  observationSource: HourlyObservationSource,
  observationRepository: HourlyObservationRepository,
  downloadedAt = new Date(),
): Promise<ObservationCollectionResult> {
  const station = await stationRepository.findById(stationId);
  if (!station) {
    throw new StationNotFoundError(stationId);
  }

  const observations = await observationSource.fetchLatestObservations(station.id, downloadedAt);
  if (observations.length === 0) {
    throw new Error(`AEMET no devolvió observaciones para ${station.id}`);
  }

  const saveResult = await observationRepository.saveMany(observations);
  const sorted = [...observations].sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) {
    throw new Error(`AEMET no devolvió observaciones para ${station.id}`);
  }

  return { stationId: station.id, received: saveResult.received, inserted: saveResult.inserted, updated: saveResult.updated, from: first.observedAt, to: last.observedAt };
}
