import { createApp, readStationIdFromArgs } from "./common.js";

const stationId = readStationIdFromArgs(process.argv.slice(2));
if (!stationId) {
  console.error("Uso: pnpm observation:report --station=<indicativo>");
  process.exit(1);
}

const app = await createApp();
const station = await app.stationRepository.findById(stationId);
if (!station) {
  console.error(`No existe la estación ${stationId}. Ejecuta primero: pnpm station:find`);
  process.exit(1);
}

const observations = await app.observationRepository.listLatest(station.id, 24);
if (observations.length === 0) {
  console.log(`No hay observaciones guardadas para ${station.id}. Ejecuta primero: pnpm observation:collect --station=${station.id}`);
  process.exit(0);
}

console.log(`Últimas 24 observaciones AEMET para ${station.id} (${station.name}), de más reciente a más antigua`);
console.table(
  observations.map((observation) => ({
    observada_utc: observation.observedAt.toISOString(),
    temperatura_c: observation.temperature,
    humedad_pct: observation.relativeHumidity,
    precipitacion_mm: observation.precipitation,
    viento_kmh: observation.windSpeed,
    direccion_grados: observation.windDirection,
    racha_kmh: observation.windGust,
    presion_hpa: observation.pressure,
    descargada_utc: observation.downloadedAt.toISOString(),
  })),
);
