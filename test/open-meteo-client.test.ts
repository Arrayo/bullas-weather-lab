import { describe, expect, it } from "vitest";
import type { WeatherStation } from "../src/domain/weather-station.js";
import { assertHasUsefulForecastData } from "../src/application/forecast-use-cases.js";
import { assertHourlyArrayLengths, buildOpenMeteoForecastUrl } from "../src/infrastructure/open-meteo/open-meteo-client.js";

const stationWithElevation: WeatherStation = {
  id: "TEST",
  name: "Test",
  province: "Murcia",
  latitude: 38.1,
  longitude: -1.5,
  elevation: 650,
};

describe("buildOpenMeteoForecastUrl", () => {
  it("incluye elevation cuando la estación tiene altitud", () => {
    const url = buildOpenMeteoForecastUrl(stationWithElevation, "gfs_global", "Europe/Madrid");

    expect(url.searchParams.get("elevation")).toBe("650");
    expect(url.searchParams.get("models")).toBe("gfs_global");
  });

  it("omite elevation cuando la estación no tiene altitud", () => {
    const url = buildOpenMeteoForecastUrl({ ...stationWithElevation, elevation: null }, "gfs_global", "Europe/Madrid");

    expect(url.searchParams.has("elevation")).toBe(false);
  });
});

describe("assertHourlyArrayLengths", () => {
  it("lanza un error descriptivo si una serie horaria no coincide", () => {
    expect(() =>
      assertHourlyArrayLengths(
        {
          time: ["2026-07-22T00:00", "2026-07-22T01:00"],
          temperature_2m: [20],
          relative_humidity_2m: [50, 51],
          precipitation: [0, 0],
          cloud_cover: [10, 20],
          wind_speed_10m: [5, 6],
          wind_direction_10m: [180, 190],
        },
        "gfs_global",
      ),
    ).toThrow("Respuesta Open-Meteo inconsistente para gfs_global");
  });
});

describe("assertHasUsefulForecastData", () => {
  it("detecta un modelo con todas las variables meteorológicas en null", () => {
    expect(() =>
      assertHasUsefulForecastData("ecmwf_aifs025", [
        { temperature2m: null, relativeHumidity2m: null, precipitation: null, windSpeed10m: null, windDirection10m: null, cloudCover: null },
        { temperature2m: null, relativeHumidity2m: null, precipitation: null, windSpeed10m: null, windDirection10m: null, cloudCover: null },
      ]),
    ).toThrow("El modelo ecmwf_aifs025 no devolvió ninguna variable meteorológica utilizable");
  });
});
