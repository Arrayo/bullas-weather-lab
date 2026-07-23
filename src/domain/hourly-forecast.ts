export interface HourlyForecast {
  stationId: string;
  collectionId: number;
  model: string;
  modelRunAt: Date | null;
  downloadedAt: Date;
  validAt: Date;
  temperature2m: number | null;
  relativeHumidity2m: number | null;
  precipitation: number | null;
  windSpeed10m: number | null;
  windDirection10m: number | null;
  cloudCover: number | null;
}
