import { collectForecastsForStation } from "../application/forecast-use-cases.js";
import { collectLatestObservations } from "../application/observation-use-cases.js";
import { ActiveCollectionRunError } from "../domain/data-collection-run.js";
import { resolveOpenMeteoModelConfig } from "../infrastructure/config.js";
import { logger } from "../infrastructure/logger.js";
import { createApp, hasJsonFlag, readStationIdFromArgs, writeJson } from "./common.js";

const args = process.argv.slice(2);
const json = hasJsonFlag(args);
const stationId = readStationIdFromArgs(args);
if (!stationId) {
  console.error("Uso: pnpm data:collect --station=<indicativo> [--json]");
  process.exit(1);
}

const app = await createApp();
const startedAt = new Date();
let runId: number | null = null;
let exiting = false;

async function failOnSignal(signal: NodeJS.Signals) {
  if (exiting) return;
  exiting = true;
  if (runId !== null) {
    await app.dataCollectionRepository.finish(runId, {
      status: "failure",
      forecastCollectionId: null,
      forecastSuccessfulModels: [],
      forecastFailedModels: [],
      observationsReceived: 0,
      observationsInserted: 0,
      observationsUpdated: 0,
      errorMessages: [`interrupted_by_${signal}`],
      finishedAt: new Date(),
    });
  }
  process.exit(1);
}

process.once("SIGINT", failOnSignal);
process.once("SIGTERM", failOnSignal);

try {
  const station = await app.stationRepository.findById(stationId);
  if (!station) throw new Error(`No existe la estación ${stationId}. Ejecuta primero: pnpm station:find`);
  await app.forecastRepository.recoverAbandonedCollections(station.id, new Date(startedAt.getTime() - app.config.COLLECTION_LOCK_TIMEOUT_MINUTES * 60_000));
  runId = await app.dataCollectionRepository.start(station.id, startedAt, app.config.COLLECTION_LOCK_TIMEOUT_MINUTES);

  const errors: string[] = [];
  let forecastCollectionId: number | null = null;
  let forecastSuccessfulModels: string[] = [];
  let forecastFailedModels: string[] = [];
  let requiredModelsSuccessful: string[] = [];
  let requiredModelsFailed: string[] = [];
  let optionalModelsSuccessful: string[] = [];
  let optionalModelsFailed: string[] = [];
  let observationsReceived = 0;
  let observationsInserted = 0;
  let observationsUpdated = 0;
  let forecastOk = false;
  let observationsOk = false;

  try {
    const modelConfig = resolveOpenMeteoModelConfig(app.config);
    const result = await collectForecastsForStation(station.id, modelConfig.all, app.stationRepository, app.openMeteoClient, app.forecastRepository, new Date());
    forecastCollectionId = result.collectionId;
    forecastSuccessfulModels = result.results.filter((item) => item.status === "success").map((item) => item.model);
    forecastFailedModels = result.results.filter((item) => item.status === "failure").map((item) => item.model);
    requiredModelsSuccessful = forecastSuccessfulModels.filter((model) => modelConfig.required.includes(model as never));
    requiredModelsFailed = forecastFailedModels.filter((model) => modelConfig.required.includes(model as never));
    optionalModelsSuccessful = forecastSuccessfulModels.filter((model) => modelConfig.optional.includes(model as never));
    optionalModelsFailed = forecastFailedModels.filter((model) => modelConfig.optional.includes(model as never));
    errors.push(...result.results.flatMap((item) => item.errorMessage ? [`${item.model}: ${item.errorMessage}`] : []));
    forecastOk = requiredModelsFailed.length === 0 && requiredModelsSuccessful.length === modelConfig.required.length;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "forecast failure");
  }

  try {
    const result = await collectLatestObservations(station.id, app.stationRepository, app.createAemetObservationClient(), app.observationRepository, new Date());
    observationsReceived = result.received;
    observationsInserted = result.inserted;
    observationsUpdated = result.updated;
    observationsOk = true;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "observation failure");
  }

  const status = forecastOk && observationsOk ? "success" : forecastOk || observationsOk ? "partial_success" : "failure";
  const finishedAt = new Date();
  await app.dataCollectionRepository.finish(runId, { status, forecastCollectionId, forecastSuccessfulModels, forecastFailedModels, requiredModelsSuccessful, requiredModelsFailed, optionalModelsSuccessful, optionalModelsFailed, observationsReceived, observationsInserted, observationsUpdated, errorMessages: errors, finishedAt });
  const output = { schemaVersion: 1, runId, stationId: station.id, status, forecastCollectionId, forecastSuccessfulModels, forecastFailedModels, requiredModelsSuccessful, requiredModelsFailed, optionalModelsSuccessful, optionalModelsFailed, observationsReceived, observationsInserted, observationsUpdated, errorMessages: errors, durationMs: finishedAt.getTime() - startedAt.getTime() };
  if (json) writeJson(output);
  else {
    console.log(`Ronda data:collect ${status} para ${station.id} (${station.name})`);
    console.log(`runId: ${runId}`);
    console.log(`Modelos correctos: ${forecastSuccessfulModels.join(", ") || "ninguno"}`);
    console.log(`Modelos fallidos: ${forecastFailedModels.join(", ") || "ninguno"}`);
    if (optionalModelsFailed.length > 0) console.log(`Modelos opcionales no disponibles: ${optionalModelsFailed.join(", ")}`);
    console.log(`Observaciones recibidas/insertadas/actualizadas: ${observationsReceived}/${observationsInserted}/${observationsUpdated}`);
    if (errors.length > 0) console.log(`Errores: ${errors.join(" | ")}`);
  }
  process.exitCode = status === "success" ? 0 : status === "partial_success" ? 2 : 1;
} catch (error) {
  if (error instanceof ActiveCollectionRunError) {
    const output = { schemaVersion: 1, status: "skipped_locked", stationId, activeRunId: error.run.id, message: error.message };
    if (json) writeJson(output); else console.error(error.message);
    process.exitCode = 3;
  } else {
    logger.error({ err: error, stationId, component: "data:collect" }, "data:collect failed");
    if (runId !== null) {
      await app.dataCollectionRepository.finish(runId, { status: "failure", forecastCollectionId: null, forecastSuccessfulModels: [], forecastFailedModels: [], observationsReceived: 0, observationsInserted: 0, observationsUpdated: 0, errorMessages: [error instanceof Error ? error.message : "technical failure"], finishedAt: new Date() });
    }
    process.exitCode = 1;
  }
}
