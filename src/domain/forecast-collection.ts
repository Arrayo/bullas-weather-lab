export type CollectionStatus = "success" | "partial_success" | "failure";

export interface ForecastCollection {
  id: number;
  stationId: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: CollectionStatus;
  successfulModels: string[];
  failedModels: string[];
}

export interface ModelCollectionResult {
  model: string;
  status: "success" | "failure";
  forecastsSaved: number;
  errorMessage?: string;
}

export interface ForecastCollectionResult {
  collectionId: number;
  stationId: string;
  status: CollectionStatus;
  results: ModelCollectionResult[];
}
