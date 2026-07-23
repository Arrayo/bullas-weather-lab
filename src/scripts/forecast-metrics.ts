import { summarizeModelPerformance } from "../application/model-performance.js";
import { OPEN_METEO_MODEL_LABELS } from "../infrastructure/open-meteo/models.js";
import { createApp, readNonNegativeIntegerArg, readStationIdFromArgs } from "./common.js";

const args = process.argv.slice(2);
const stationId = readStationIdFromArgs(args);
if (!stationId) {
  console.error("Uso: pnpm forecast:metrics --station=<indicativo> [--minimum-lead-minutes=30]");
  process.exit(1);
}

const app = await createApp();
const minimumLeadMinutes = readNonNegativeIntegerArg(args, "minimum-lead-minutes", app.config.FORECAST_MINIMUM_LEAD_MINUTES);
const station = await app.stationRepository.findById(stationId);
if (!station) {
  console.error(`No existe la estación ${stationId}. Ejecuta primero: pnpm station:find`);
  process.exit(1);
}

const verification = await app.forecastRepository.verifyAgainstObservations(station.id, { minimumLeadMinutes });
const summaries = summarizeModelPerformance(station.id, verification.rows);
const publishable = summaries.filter((summary) => summary.meanAbsoluteError !== null);

if (publishable.length === 0) {
  console.log("Todavía no hay suficientes predicciones realizadas con antelación para calcular métricas fiables.");
  console.log(`Verificaciones temporalmente válidas: ${verification.rows.length}`);
  process.exit(0);
}

console.log(`Métricas iniciales para ${station.id} (${station.name})`);
console.table(
  summaries.map((summary) => ({
    modelo: OPEN_METEO_MODEL_LABELS[summary.model as keyof typeof OPEN_METEO_MODEL_LABELS] ?? summary.model,
    variable: summary.variable,
    horizonte: summary.leadTimeBucket,
    muestras: summary.sampleCount,
    ME: summary.meanError ?? "muestras insuficientes",
    MAE: summary.meanAbsoluteError ?? "muestras insuficientes",
    RMSE: summary.rootMeanSquaredError ?? "muestras insuficientes",
  })),
);
