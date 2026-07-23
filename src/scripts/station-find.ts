import { refreshAndFindStationCandidates } from "../application/station-use-cases.js";
import { saveJobExecution } from "../infrastructure/database/repositories.js";
import { logger } from "../infrastructure/logger.js";
import { createApp } from "./common.js";

const startedAt = new Date();
const app = await createApp();

try {
  const candidates = await refreshAndFindStationCandidates(app.createAemetClient(), app.stationRepository);
  console.table(
    candidates.map((station) => ({
      indicativo: station.id,
      nombre: station.name,
      provincia: station.province,
      latitud: station.latitude,
      longitud: station.longitude,
      altitud: station.elevation,
    })),
  );
  await saveJobExecution(app.db, "station:find", startedAt, "success", `${candidates.length} candidatas encontradas`);
} catch (error) {
  await saveJobExecution(app.db, "station:find", startedAt, "failure", error instanceof Error ? error.message : "Error desconocido");
  logger.error({ err: error }, "No se pudo buscar el inventario de estaciones");
  process.exitCode = 1;
}
