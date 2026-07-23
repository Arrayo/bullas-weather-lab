import { collectLatestObservations } from "../application/observation-use-cases.js";
import { saveJobExecution } from "../infrastructure/database/repositories.js";
import { logger } from "../infrastructure/logger.js";
import { createApp, readStationIdFromArgs } from "./common.js";

const stationId = readStationIdFromArgs(process.argv.slice(2));
if (!stationId) {
  console.error("Uso: pnpm observation:collect --station=<indicativo>");
  process.exit(1);
}

const startedAt = new Date();
const app = await createApp();

try {
  const station = await app.stationRepository.findById(stationId);
  const result = await collectLatestObservations(
    stationId,
    app.stationRepository,
    app.createAemetObservationClient(),
    app.observationRepository,
  );

  await saveJobExecution(app.db, "observation:collect", startedAt, "success", `${result.inserted} insertadas, ${result.updated} actualizadas para ${result.stationId}`);
  console.log(`Observaciones AEMET guardadas para ${result.stationId}${station ? ` (${station.name})` : ""}`);
  console.log("");
  console.log(`Recibidas: ${result.received}`);
  console.log(`Insertadas: ${result.inserted}`);
  console.log(`Actualizadas: ${result.updated}`);
  console.log(`Desde: ${result.from.toISOString()}`);
  console.log(`Hasta: ${result.to.toISOString()}`);
} catch (error) {
  await saveJobExecution(app.db, "observation:collect", startedAt, "failure", error instanceof Error ? error.message : "Error desconocido");
  logger.error({ err: error }, "No se pudieron recopilar observaciones AEMET");
  process.exitCode = 1;
}
