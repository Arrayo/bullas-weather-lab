export interface ForecastVerificationRow {
  hourUtc: Date;
  model: string;
  leadTimeMinutes: number;
  leadTimeHours: number;
  forecastDownloadedAt: Date;
  forecastCollectionId: number;
  forecastTemperature: number | null;
  observedTemperature: number | null;
  temperatureError: number | null;
  forecastHumidity: number | null;
  observedHumidity: number | null;
  humidityError: number | null;
  forecastWindSpeed: number | null;
  observedWindSpeed: number | null;
  windSpeedError: number | null;
  forecastPrecipitation: number | null;
  observedPrecipitation: number | null;
  precipitationError: number | null;
}

export interface ForecastVerificationOptions {
  hours?: number;
  minimumLeadMinutes: number;
  minLeadHours?: number;
  maxLeadHours?: number;
}

export interface ForecastVerificationResult {
  rows: ForecastVerificationRow[];
  discardedAfterValidTimeCount: number;
  discardedBelowMinimumLeadCount: number;
}
