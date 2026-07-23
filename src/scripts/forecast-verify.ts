import { OPEN_METEO_MODEL_LABELS } from "../infrastructure/open-meteo/models.js";
import { createApp, readHoursFromArgs, readNonNegativeIntegerArg, readNonNegativeNumberArg, readStationIdFromArgs } from "./common.js";

const args = process.argv.slice(2);
const stationId = readStationIdFromArgs(args);
if (!stationId) {
  console.error("Uso: pnpm forecast:verify --station=<indicativo> [--hours=48]");
  process.exit(1);
}

const app = await createApp();
const hours = readHoursFromArgs(args, 24);
const minimumLeadMinutes = readNonNegativeIntegerArg(args, "minimum-lead-minutes", app.config.FORECAST_MINIMUM_LEAD_MINUTES);
const minLeadHours = readNonNegativeNumberArg(args, "min-lead-hours");
const maxLeadHours = readNonNegativeNumberArg(args, "max-lead-hours");
if (minLeadHours !== undefined && maxLeadHours !== undefined && minLeadHours > maxLeadHours) {
  throw new Error("--min-lead-hours no puede ser mayor que --max-lead-hours");
}
const station = await app.stationRepository.findById(stationId);
if (!station) {
  console.error(`No existe la estación ${stationId}. Ejecuta primero: pnpm station:find`);
  process.exit(1);
}

const verificationOptions = {
  hours,
  minimumLeadMinutes,
  ...(minLeadHours === undefined ? {} : { minLeadHours }),
  ...(maxLeadHours === undefined ? {} : { maxLeadHours }),
};
const result = await app.forecastRepository.verifyAgainstObservations(station.id, verificationOptions);
const rows = result.rows;
if (rows.length === 0) {
  console.log(`No hay verificaciones temporalmente válidas para ${station.id}.`);
  console.log(`Predicciones descartadas por haber sido descargadas después de su hora válida: ${result.discardedAfterValidTimeCount}`);
  console.log(`Predicciones descartadas por margen mínimo insuficiente: ${result.discardedBelowMinimumLeadCount}`);
  process.exit(0);
}

console.log(`Verificación inicial forecast-real para ${station.id} (${station.name})`);
console.log(`Predicciones descartadas por haber sido descargadas después de su hora válida: ${result.discardedAfterValidTimeCount}`);
console.log(`Predicciones descartadas por margen mínimo insuficiente: ${result.discardedBelowMinimumLeadCount}`);
console.table(
  rows.map((row) => ({
    hora_utc: row.hourUtc.toISOString(),
    modelo: OPEN_METEO_MODEL_LABELS[row.model as keyof typeof OPEN_METEO_MODEL_LABELS] ?? row.model,
    descargada_utc: row.forecastDownloadedAt.toISOString(),
    horizonte_horas: Number(row.leadTimeHours.toFixed(2)),
    prediccion_temperatura: row.forecastTemperature,
    temperatura_real: row.observedTemperature,
    error_temperatura: row.temperatureError,
    prediccion_humedad: row.forecastHumidity,
    humedad_real: row.observedHumidity,
    error_humedad: row.humidityError,
    prediccion_precipitacion: row.forecastPrecipitation,
    precipitacion_real: row.observedPrecipitation,
    error_precipitacion: row.precipitationError,
    prediccion_viento: row.forecastWindSpeed,
    viento_real: row.observedWindSpeed,
    error_viento: row.windSpeedError,
  })),
);
