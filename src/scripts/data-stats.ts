import { statSync } from "node:fs";
import { sql } from "drizzle-orm";
import { databaseKind, sqlitePathFromDatabaseUrl } from "../infrastructure/config.js";
import { createApp, hasJsonFlag, queryAll, readStationIdFromArgs, writeJson } from "./common.js";

const args = process.argv.slice(2);
const json = hasJsonFlag(args);
const stationId = readStationIdFromArgs(args);
if (!stationId) {
  console.error("Uso: pnpm data:stats --station=<indicativo> [--json]");
  process.exit(1);
}

const app = await createApp();
const forecastsByModel = await queryAll<{ model: string; count: number; first_downloaded_at: string | null; last_downloaded_at: string | null; first_valid_at: string | null; last_valid_at: string | null }>(app.db, sql`
  SELECT model, COUNT(*) AS count, MIN(downloaded_at) AS first_downloaded_at, MAX(downloaded_at) AS last_downloaded_at, MIN(valid_at) AS first_valid_at, MAX(valid_at) AS last_valid_at
  FROM hourly_forecasts WHERE station_id = ${stationId} GROUP BY model ORDER BY model
`);
const collectionsByStatus = await queryAll<{ status: string; count: number }>(app.db, sql`SELECT status, COUNT(*) AS count FROM forecast_collections WHERE station_id = ${stationId} GROUP BY status`);
const [collectionCount] = await queryAll<{ count: number }>(app.db, sql`SELECT COUNT(*) AS count FROM forecast_collections WHERE station_id = ${stationId}`);
const [observations] = await queryAll<{ count: number; first_observed_at: string | null; last_observed_at: string | null }>(app.db, sql`SELECT COUNT(*) AS count, MIN(observed_at) AS first_observed_at, MAX(observed_at) AS last_observed_at FROM hourly_observations WHERE station_id = ${stationId}`);
const verification = await app.forecastRepository.verifyAgainstObservations(stationId, { minimumLeadMinutes: app.config.FORECAST_MINIMUM_LEAD_MINUTES });
const verificationsByModel = Object.entries(verification.rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.model]: (acc[row.model] ?? 0) + 1 }), {})).map(([model, count]) => ({ model, count }));
const runsByStatus = await queryAll<{ status: string; count: number }>(app.db, sql`SELECT status, COUNT(*) AS count FROM data_collection_runs WHERE station_id = ${stationId} GROUP BY status`);
const sqliteSizeBytes = databaseKind(app.config.DATABASE_URL) === "sqlite" ? statSync(sqlitePathFromDatabaseUrl(app.config.DATABASE_URL)).size : null;

const output = { schemaVersion: 1, stationId, collectionCount: collectionCount?.count ?? 0, collectionsByStatus, forecastsByModel, observations: observations ?? { count: 0, first_observed_at: null, last_observed_at: null }, verificationsByModel, sqliteSizeBytes, runsByStatus };
if (json) writeJson(output);
else {
  console.log(`Estadísticas para ${stationId}`);
  console.log(`Colecciones: ${output.collectionCount}`);
  console.table(collectionsByStatus);
  console.table(forecastsByModel);
  console.log(`Observaciones: ${output.observations.count} (${output.observations.first_observed_at ?? "n/a"} -> ${output.observations.last_observed_at ?? "n/a"})`);
  console.table(verificationsByModel);
  console.log(`SQLite bytes: ${sqliteSizeBytes ?? "n/a"}`);
  console.table(runsByStatus);
}
