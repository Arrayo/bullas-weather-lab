import { readStationIdFromArgs, createApp } from "./common.js";
import { OPEN_METEO_MODEL_LABELS } from "../infrastructure/open-meteo/models.js";

const stationId = readStationIdFromArgs(process.argv.slice(2));
if (!stationId) {
  console.error("Uso: pnpm forecast:report --station=<indicativo>");
  process.exit(1);
}

const app = await createApp();
const station = await app.stationRepository.findById(stationId);
if (!station) {
  console.error(`No existe la estación ${stationId}. Ejecuta primero: pnpm station:find`);
  process.exit(1);
}

const forecasts = await app.forecastRepository.listNextHours(stationId, 48);
if (forecasts.length === 0) {
  console.error(`No hay predicciones para ${stationId}. Ejecuta primero: pnpm forecast:collect --station=${stationId}`);
  process.exit(1);
}

console.log(`Comparativa próximas 48 horas para ${station.id} (${station.name})`);
console.table(
  forecasts.map((forecast) => ({
    valida_utc: forecast.validAt.toISOString(),
    modelo: OPEN_METEO_MODEL_LABELS[forecast.model as keyof typeof OPEN_METEO_MODEL_LABELS] ?? forecast.model,
    modelo_ejecucion_utc: forecast.modelRunAt?.toISOString() ?? "desconocida",
    descargada_utc: forecast.downloadedAt.toISOString(),
    temp_c: forecast.temperature2m,
    humedad_pct: forecast.relativeHumidity2m,
    precipitacion_mm: forecast.precipitation,
    viento_kmh: forecast.windSpeed10m,
    direccion_grados: forecast.windDirection10m,
    nubosidad_pct: forecast.cloudCover,
  })),
);
