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
  /** Caps Turso row reads: only forecasts with valid_at within this window. Default 336h (14d). */
  lookbackHours?: number;
  /** Extra full-table discard counts; off by default (expensive on Turso). */
  includeDiscardStats?: boolean;
}

export interface ForecastVerificationResult {
  rows: ForecastVerificationRow[];
  discardedAfterValidTimeCount: number;
  discardedBelowMinimumLeadCount: number;
}
