export type PerformanceVariable = "temperature" | "relative_humidity" | "wind_speed" | "precipitation";

export interface ModelPerformanceSummary {
  stationId: string;
  model: string;
  variable: PerformanceVariable;
  leadTimeBucket: string;
  sampleCount: number;
  meanError: number | null;
  meanAbsoluteError: number | null;
  rootMeanSquaredError: number | null;
}
