import { z } from "zod";
import type { ForecastSource } from "../../application/ports.js";
import type { HourlyForecast } from "../../domain/hourly-forecast.js";
import type { WeatherStation } from "../../domain/weather-station.js";
import type { JsonHttpClient } from "../http/http-client.js";
import { zonedDateTimeToUtc } from "./time.js";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const HOURLY_VARIABLES = [
  "temperature_2m",
  "relative_humidity_2m",
  "precipitation",
  "cloud_cover",
  "wind_speed_10m",
  "wind_direction_10m",
] as const;

const nullableNumberArray = z.array(z.number().nullable());
const openMeteoForecastSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: nullableNumberArray,
    relative_humidity_2m: nullableNumberArray,
    precipitation: nullableNumberArray,
    cloud_cover: nullableNumberArray,
    wind_speed_10m: nullableNumberArray,
    wind_direction_10m: nullableNumberArray,
  }),
});

export class OpenMeteoClient implements ForecastSource {
  constructor(
    private readonly httpClient: JsonHttpClient,
    private readonly timeZone: string,
  ) {}

  async fetchHourlyForecast(station: WeatherStation, model: string, collectionId: number, downloadedAt: Date): Promise<HourlyForecast[]> {
    const url = buildOpenMeteoForecastUrl(station, model, this.timeZone);
    const response = openMeteoForecastSchema.parse(await this.httpClient.getJson(url.toString()));
    assertHourlyArrayLengths(response.hourly, model);

    return response.hourly.time.map((time, index) => ({
      collectionId,
      stationId: station.id,
      model,
      modelRunAt: null,
      downloadedAt,
      validAt: zonedDateTimeToUtc(time, this.timeZone),
      temperature2m: valueAt(response.hourly.temperature_2m, index),
      relativeHumidity2m: valueAt(response.hourly.relative_humidity_2m, index),
      precipitation: valueAt(response.hourly.precipitation, index),
      windSpeed10m: valueAt(response.hourly.wind_speed_10m, index),
      windDirection10m: valueAt(response.hourly.wind_direction_10m, index),
      cloudCover: valueAt(response.hourly.cloud_cover, index),
    }));
  }
}

export function buildOpenMeteoForecastUrl(station: WeatherStation, model: string, timeZone: string): URL {
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", station.latitude.toString());
  url.searchParams.set("longitude", station.longitude.toString());
  if (station.elevation !== null) {
    url.searchParams.set("elevation", station.elevation.toString());
  }
  url.searchParams.set("hourly", HOURLY_VARIABLES.join(","));
  url.searchParams.set("models", model);
  url.searchParams.set("timezone", timeZone);
  url.searchParams.set("forecast_days", "7");
  return url;
}

type OpenMeteoHourly = z.infer<typeof openMeteoForecastSchema>["hourly"];

export function assertHourlyArrayLengths(hourly: OpenMeteoHourly, model: string): void {
  const expectedLength = hourly.time.length;
  const lengths = {
    time: hourly.time.length,
    temperature_2m: hourly.temperature_2m.length,
    relative_humidity_2m: hourly.relative_humidity_2m.length,
    precipitation: hourly.precipitation.length,
    cloud_cover: hourly.cloud_cover.length,
    wind_speed_10m: hourly.wind_speed_10m.length,
    wind_direction_10m: hourly.wind_direction_10m.length,
  };

  const mismatched = Object.entries(lengths).filter(([, length]) => length !== expectedLength);
  if (mismatched.length > 0) {
    const details = mismatched.map(([name, length]) => `${name}=${length}`).join(", ");
    throw new Error(`Respuesta Open-Meteo inconsistente para ${model}: hourly.time=${expectedLength}, ${details}`);
  }
}

function valueAt(values: readonly (number | null)[], index: number): number | null {
  return values[index] ?? null;
}
