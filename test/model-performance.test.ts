import { describe, expect, it } from "vitest";
import { summarizeModelPerformance } from "../src/application/model-performance.js";
import type { ForecastVerificationRow } from "../src/domain/forecast-verification.js";

describe("summarizeModelPerformance", () => {
  it("calcula ME, MAE y RMSE", () => {
    const rows = [-2, -1, 0, 1, 2].map((error, index) => makeVerificationRow(error, index));

    const [summary] = summarizeModelPerformance("STATION", rows).filter((item) => item.variable === "temperature" && item.leadTimeBucket === "0-6 h");

    expect(summary?.sampleCount).toBe(5);
    expect(summary?.meanError).toBe(0);
    expect(summary?.meanAbsoluteError).toBe(1.2);
    expect(summary?.rootMeanSquaredError).toBeCloseTo(Math.sqrt(2), 8);
  });

  it("ignora null por variable", () => {
    const rows = [0, 1, 2, 3, 4].map((error, index) => ({ ...makeVerificationRow(error, index), humidityError: index === 0 ? null : error }));

    const humidity = summarizeModelPerformance("STATION", rows).find((item) => item.variable === "relative_humidity" && item.leadTimeBucket === "0-6 h");

    expect(humidity?.sampleCount).toBe(4);
    expect(humidity?.meanError).toBeNull();
  });

  it("no publica métricas con menos de cinco muestras", () => {
    const rows = [1, 2, 3, 4].map((error, index) => makeVerificationRow(error, index));

    const temperature = summarizeModelPerformance("STATION", rows).find((item) => item.variable === "temperature" && item.leadTimeBucket === "0-6 h");

    expect(temperature?.sampleCount).toBe(4);
    expect(temperature?.meanAbsoluteError).toBeNull();
  });

  it("separa correctamente buckets de horizonte con límite superior exclusivo", () => {
    const rows = [
      makeVerificationRow(1, 0, 5.99),
      makeVerificationRow(2, 1, 6),
      makeVerificationRow(3, 2, 11.99),
      makeVerificationRow(4, 3, 12),
      makeVerificationRow(5, 4, 23.99),
    ];

    const summaries = summarizeModelPerformance("STATION", rows);
    const bucket0to6 = summaries.find((item) => item.variable === "temperature" && item.leadTimeBucket === "0-6 h");
    const bucket6to12 = summaries.find((item) => item.variable === "temperature" && item.leadTimeBucket === "6-12 h");
    const bucket12to24 = summaries.find((item) => item.variable === "temperature" && item.leadTimeBucket === "12-24 h");

    expect(bucket0to6?.sampleCount).toBe(1);
    expect(bucket6to12?.sampleCount).toBe(2);
    expect(bucket12to24?.sampleCount).toBe(2);
  });
});

function makeVerificationRow(error: number, index: number, leadTimeHours = 1): ForecastVerificationRow {
  return {
    hourUtc: new Date(Date.UTC(2026, 6, 22, index)),
    model: "gfs_global",
    leadTimeMinutes: leadTimeHours * 60,
    leadTimeHours,
    forecastDownloadedAt: new Date(Date.UTC(2026, 6, 21, index)),
    forecastCollectionId: 1,
    forecastTemperature: 20 + error,
    observedTemperature: 20,
    temperatureError: error,
    forecastHumidity: 50 + error,
    observedHumidity: 50,
    humidityError: error,
    forecastWindSpeed: 10 + error,
    observedWindSpeed: 10,
    windSpeedError: error,
    forecastPrecipitation: null,
    observedPrecipitation: null,
    precipitationError: null,
  };
}
