export type DataCollectionStatus = "running" | "success" | "partial_success" | "failure";

export interface DataCollectionRun {
  id: number;
  stationId: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  status: DataCollectionStatus;
  forecastCollectionId: number | null;
  forecastSuccessfulModels: string[];
  forecastFailedModels: string[];
  requiredModelsSuccessful: string[];
  requiredModelsFailed: string[];
  optionalModelsSuccessful: string[];
  optionalModelsFailed: string[];
  observationsReceived: number;
  observationsInserted: number;
  observationsUpdated: number;
  errorMessages: string[];
}

export class ActiveCollectionRunError extends Error {
  constructor(public readonly run: DataCollectionRun) {
    super(`Ya existe una ejecución activa para ${run.stationId}: runId=${run.id}`);
    this.name = "ActiveCollectionRunError";
  }
}
