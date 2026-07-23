import { collectForecastsForStation } from "../application/forecast-use-cases.js";
import type { ModelCollectionResult } from "../domain/forecast-collection.js";
import { resolveOpenMeteoModels } from "../infrastructure/config.js";
import { saveJobExecution } from "../infrastructure/database/repositories.js";
import { logger } from "../infrastructure/logger.js";
import { OPEN_METEO_MODEL_LABELS } from "../infrastructure/open-meteo/models.js";
import { createApp, readStationIdFromArgs } from "./common.js";

const stationId = readStationIdFromArgs(process.argv.slice(2));
if (!stationId) {
  console.error("Uso: pnpm forecast:collect --station=<indicativo>");
  process.exit(1);
}

const startedAt = new Date();
const app = await createApp();

try {
  const models = resolveOpenMeteoModels(app.config);
  const collection = await collectForecastsForStation(
    stationId,
    models,
    app.stationRepository,
    app.openMeteoClient,
    app.forecastRepository,
  );

  printResults(collection.results);
  const successCount = collection.results.filter((result) => result.status === "success").length;
  const failureCount = collection.results.length - successCount;
  console.log(`Colección completada: ${successCount} correctos, ${failureCount} fallido${failureCount === 1 ? "" : "s"}.`);

  await saveJobExecution(app.db, "forecast:collect", startedAt, collection.status, `Colección ${collection.collectionId}: ${successCount} correctos, ${failureCount} fallidos`);
  if (collection.status === "failure") {
    process.exitCode = 1;
  }
} catch (error) {
  await saveJobExecution(app.db, "forecast:collect", startedAt, "failure", error instanceof Error ? error.message : "Error desconocido");
  logger.error({ err: error }, "No se pudieron recopilar predicciones");
  process.exitCode = 1;
}

function printResults(results: readonly ModelCollectionResult[]): void {
  console.table(
    results.map((result) => ({
      Modelo: OPEN_METEO_MODEL_LABELS[result.model as keyof typeof OPEN_METEO_MODEL_LABELS] ?? result.model,
      Estado: result.status,
      "Horas guardadas": result.forecastsSaved,
      Error: result.errorMessage ?? "",
    })),
  );
}
