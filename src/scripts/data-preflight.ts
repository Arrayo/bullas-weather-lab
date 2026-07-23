import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ActiveCollectionRunError } from "../domain/data-collection-run.js";
import { resolveOpenMeteoModelConfig } from "../infrastructure/config.js";
import { createApp, hasJsonFlag, readStationIdFromArgs, writeJson } from "./common.js";

const args = process.argv.slice(2);
const json = hasJsonFlag(args);
const stationId = readStationIdFromArgs(args);
const checks: { name: string; ok: boolean; message: string }[] = [];

function add(name: string, ok: boolean, message: string) { checks.push({ name, ok, message }); }

try {
  if (!stationId) throw new Error("Falta --station=<indicativo>");
  const app = await createApp();
  add("config", true, "Configuración válida");
  add("aemet_api_key", app.config.AEMET_API_KEY.trim().length > 0, app.config.AEMET_API_KEY.trim().length > 0 ? "AEMET_API_KEY presente" : "AEMET_API_KEY ausente");
  const modelConfig = resolveOpenMeteoModelConfig(app.config);
  add("models", true, `Required: ${modelConfig.required.join(", ")} Optional: ${modelConfig.optional.join(", ")}`);
  const station = await app.stationRepository.findById(stationId);
  add("station", station !== null, station ? `Estación ${station.id} existe` : `No existe ${stationId}`);
  mkdirSync(resolve("logs"), { recursive: true });
  add("logs", true, `Directorio ${resolve("logs")} escribible o creado`);
  const running = await app.dataCollectionRepository.countRunning(stationId);
  add("lock", running === 0, running === 0 ? "Sin bloqueo activo" : "Hay bloqueo activo");
  const ok = checks.every((check) => check.ok);
  const output = { schemaVersion: 1, status: ok ? "ready" : "failure", stationId, checks };
  if (json) writeJson(output); else checks.forEach((check) => console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.message}`));
  process.exitCode = ok ? 0 : running > 0 ? 3 : 1;
} catch (error) {
  const output = { schemaVersion: 1, status: error instanceof ActiveCollectionRunError ? "locked" : "failure", stationId, error: error instanceof Error ? error.message : "Error desconocido", checks };
  if (json) writeJson(output); else console.error(output.error);
  process.exitCode = error instanceof ActiveCollectionRunError ? 3 : 1;
}
