import type { ForecastVerificationRow } from "../domain/forecast-verification.js";
import type { ModelPerformanceSummary, PerformanceVariable } from "../domain/model-performance.js";

const MINIMUM_SAMPLES = 5;

export const LEAD_TIME_BUCKETS = [
  { label: "0-6 h", minHours: 0, maxHours: 6 },
  { label: "6-12 h", minHours: 6, maxHours: 12 },
  { label: "12-24 h", minHours: 12, maxHours: 24 },
  { label: "24-48 h", minHours: 24, maxHours: 48 },
  { label: "48-72 h", minHours: 48, maxHours: 72 },
  { label: "72-120 h", minHours: 72, maxHours: 120 },
  { label: "120-168 h", minHours: 120, maxHours: 168 },
] as const;

export function summarizeModelPerformance(stationId: string, rows: readonly ForecastVerificationRow[]): ModelPerformanceSummary[] {
  const summaries: ModelPerformanceSummary[] = [];
  const models = [...new Set(rows.map((row) => row.model))].sort();

  for (const model of models) {
    for (const bucket of LEAD_TIME_BUCKETS) {
      const bucketRows = rows.filter((row) => row.model === model && row.leadTimeHours >= bucket.minHours && row.leadTimeHours < bucket.maxHours);
      for (const variable of ["temperature", "relative_humidity", "wind_speed"] satisfies PerformanceVariable[]) {
        summaries.push(summarizeVariable(stationId, model, variable, bucket.label, errorsForVariable(bucketRows, variable)));
      }
    }
  }

  return summaries;
}

function summarizeVariable(stationId: string, model: string, variable: PerformanceVariable, leadTimeBucket: string, errors: number[]): ModelPerformanceSummary {
  if (errors.length < MINIMUM_SAMPLES) {
    return { stationId, model, variable, leadTimeBucket, sampleCount: errors.length, meanError: null, meanAbsoluteError: null, rootMeanSquaredError: null };
  }

  return {
    stationId,
    model,
    variable,
    leadTimeBucket,
    sampleCount: errors.length,
    meanError: mean(errors),
    meanAbsoluteError: mean(errors.map(Math.abs)),
    rootMeanSquaredError: Math.sqrt(mean(errors.map((error) => error ** 2))),
  };
}

function errorsForVariable(rows: readonly ForecastVerificationRow[], variable: PerformanceVariable): number[] {
  return rows.flatMap((row) => {
    const error = variable === "temperature" ? row.temperatureError : variable === "relative_humidity" ? row.humidityError : row.windSpeedError;
    return error === null ? [] : [error];
  });
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
