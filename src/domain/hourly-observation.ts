export interface HourlyObservation {
  stationId: string;
  observedAt: Date;
  downloadedAt: Date;
  temperature: number | null;
  relativeHumidity: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGust: number | null;
  pressure: number | null;
  source: "aemet";
}
