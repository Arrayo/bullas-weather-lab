import type { WeatherStation } from "../domain/weather-station.js";
import type { WeatherStationInventorySource, WeatherStationRepository } from "./ports.js";

const DEFAULT_CANDIDATE_TERMS = ["bullas", "murcia"];

export async function refreshAndFindStationCandidates(
  source: WeatherStationInventorySource,
  repository: WeatherStationRepository,
  terms = DEFAULT_CANDIDATE_TERMS,
): Promise<WeatherStation[]> {
  const stations = await source.fetchStations();
  await repository.saveMany(stations);
  return repository.searchCandidates(terms);
}
