import type { AppDb } from "./database-types.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";

const REQUIRED_TABLES = ["weather_stations", "model_runs", "forecast_collections", "hourly_forecasts", "hourly_observations", "job_executions", "data_collection_runs"];

export async function assertDatabaseMigrated(db: AppDb): Promise<void> {
  const rows = await db.all<{ name: string }>(sql.raw("SELECT name FROM sqlite_master WHERE type = 'table'"));
  const tables = new Set(rows.map((row) => row.name));
  const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
  if (missing.length > 0) {
    throw new Error(`Base de datos sin migrar. Ejecuta pnpm db:migrate. Faltan tablas: ${missing.join(", ")}`);
  }
  if (!tables.has("__drizzle_migrations")) {
    throw new Error("Base de datos sin migrar. Falta la tabla __drizzle_migrations de Drizzle");
  }
  const [{ count } = { count: 0 }] = await db.all<{ count: number }>(sql.raw("SELECT COUNT(*) AS count FROM __drizzle_migrations"));
  const expected = listMigrationFilesForTests().length;
  if (count < expected) {
    throw new Error(`Base de datos con migraciones pendientes. Aplicadas: ${count}. Esperadas: ${expected}`);
  }
}

export function applyMigrationsForTests(db: AppDb): void {
  const files = readdirSync(join(process.cwd(), "drizzle"))
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  for (const file of files) {
    const migrationSql = readFileSync(join(process.cwd(), "drizzle", file), "utf8");
    for (const statement of migrationSql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
      db.run(statement);
    }
    db.run(sql`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
    db.run(sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${file}, ${Date.now()})`);
  }
}


export function listMigrationFilesForTests(): string[] {
  return readdirSync(join(process.cwd(), "drizzle")).filter((file) => file.endsWith(".sql")).sort((left, right) => left.localeCompare(right));
}
