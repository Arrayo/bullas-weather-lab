import { createClient, type Client, type InStatement } from "@libsql/client";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { loadConfig, sqlitePathFromDatabaseUrl } from "../infrastructure/config.js";
import { assertDatabaseMigrated } from "../infrastructure/database/migrate.js";
import * as schema from "../infrastructure/database/schema.js";

type SqlValue = string | number | bigint | boolean | ArrayBuffer | null;
type SourceRow = Record<string, string | number | null>;

export const IMPORT_TABLES = [
  "weather_stations",
  "model_runs",
  "forecast_collections",
  "hourly_forecasts",
  "hourly_observations",
  "job_executions",
  "data_collection_runs",
] as const;
export type ImportTable = (typeof IMPORT_TABLES)[number];

/** Batch size for remote upserts (100–250). */
export const BATCH_SIZE = 200;
export const ID_PAGE_SIZE = 1000;
export const REMOTE_TIMEOUT_MS = 60_000;

export interface TableImportResult {
  sourceCount: number;
  targetCountBefore: number;
  inserted: number;
  updated: number;
  targetCountAfter: number;
  batches?: number;
  durationMs?: number;
}

const NATURAL_KEY_CHECKS: Partial<Record<ImportTable, { columns: string[] }>> = {
  hourly_forecasts: { columns: ["collection_id", "station_id", "model", "valid_at"] },
  hourly_observations: { columns: ["station_id", "observed_at", "source"] },
  data_collection_runs: { columns: ["station_id", "status"] },
};

export function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("El tamaño de lote debe ser >= 1");
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

export function countInsertUpdate(sourceIds: readonly unknown[], targetIds: ReadonlySet<string>): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  for (const id of sourceIds) {
    if (targetIds.has(String(id))) updated += 1;
    else inserted += 1;
  }
  return { inserted, updated };
}

export async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = REMOTE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout tras ${timeoutMs}ms en ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function logProgress(message: string): void {
  console.error(message);
}

export async function loadTargetIdSet(client: Client, table: ImportTable, pageSize = ID_PAGE_SIZE): Promise<Set<string>> {
  const ids = new Set<string>();
  let lastId: string | number | null = null;

  for (;;) {
    const result =
      lastId === null
        ? await withTimeout(client.execute(`SELECT id FROM ${table} ORDER BY id LIMIT ${pageSize}`), `leer ids de ${table}`)
        : await withTimeout(
            client.execute({ sql: `SELECT id FROM ${table} WHERE id > ? ORDER BY id LIMIT ${pageSize}`, args: [toSqlValue(lastId)] }),
            `leer ids de ${table}`,
          );

    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      const id = row.id;
      if (id === null || id === undefined) continue;
      ids.add(String(id));
      lastId = id as string | number;
    }

    if (result.rows.length < pageSize) break;
  }

  return ids;
}

export async function importLocalToClient(
  sourceDb: Database.Database,
  targetClient: Client,
  dryRun: boolean,
  options: { batchSize?: number; pageSize?: number } = {},
): Promise<Record<ImportTable, TableImportResult>> {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const pageSize = options.pageSize ?? ID_PAGE_SIZE;

  logProgress("Conectando al destino y aplicando migraciones...");
  await withTimeout(targetClient.execute("SELECT 1"), "ping destino");
  const targetDb = drizzle(targetClient, { schema });
  await withTimeout(migrate(targetDb, { migrationsFolder: "drizzle" }), "migraciones destino");
  await assertDatabaseMigrated(targetDb as never);
  logProgress("Destino migrado. Iniciando importación por tablas...");

  const results = {} as Record<ImportTable, TableImportResult>;
  const totalTables = IMPORT_TABLES.length;

  for (const [index, table] of IMPORT_TABLES.entries()) {
    const tableNo = index + 1;
    const startedAt = Date.now();
    logProgress(`[${tableNo}/${totalTables}] ${table}: leyendo origen...`);

    await assertNoNaturalKeyConflict(sourceDb, targetClient, table, pageSize);

    const rows = sourceDb.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as SourceRow[];
    logProgress(`[${tableNo}/${totalTables}] ${table}: leyendo ids del destino...`);
    const targetIds = await loadTargetIdSet(targetClient, table, pageSize);
    const { inserted, updated } = countInsertUpdate(
      rows.map((row) => row.id),
      targetIds,
    );

    logProgress(`[${tableNo}/${totalTables}] ${table}: source=${rows.length} target=${targetIds.size} inserted=${inserted} updated=${updated}`);

    let batches = 0;
    if (!dryRun && rows.length > 0) {
      const chunks = chunkRows(rows, batchSize);
      logProgress(`[${tableNo}/${totalTables}] ${table}: escribiendo ${rows.length} filas en ${chunks.length} lote(s)...`);
      for (const [batchIndex, chunk] of chunks.entries()) {
        await upsertRowsBatch(targetClient, table, chunk, tableNo, totalTables, batchIndex + 1, chunks.length);
        batches += 1;
      }
    }

    const durationMs = Date.now() - startedAt;
    const targetCountAfter = dryRun ? targetIds.size : await countTarget(targetClient, table);
    results[table] = {
      sourceCount: rows.length,
      targetCountBefore: targetIds.size,
      inserted,
      updated,
      targetCountAfter,
      batches: dryRun ? 0 : batches,
      durationMs,
    };
    logProgress(`[${tableNo}/${totalTables}] ${table}: ok rows=${rows.length} batches=${results[table].batches} durationMs=${durationMs}`);
  }

  if (!dryRun) {
    await verifyRelationships(targetClient);
    await ensureAutoincrementSequences(targetClient);
    await verifyAutoincrementSequences(targetClient);
  }

  return results;
}

async function countTarget(client: Client, table: ImportTable): Promise<number> {
  const result = await withTimeout(client.execute(`SELECT COUNT(*) AS count FROM ${table}`), `contar ${table}`);
  return Number(result.rows[0]?.count ?? 0);
}

function buildUpsertStatement(table: ImportTable, row: SourceRow): InStatement {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  const updates = columns
    .filter((column) => column !== "id")
    .map((column) => `${column}=excluded.${column}`)
    .join(", ");
  return {
    sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
    args: columns.map((column) => toSqlValue(row[column])),
  };
}

export async function upsertRowsBatch(
  client: Client,
  table: ImportTable,
  rows: SourceRow[],
  tableNo?: number,
  totalTables?: number,
  batchNo?: number,
  totalBatches?: number,
): Promise<void> {
  if (rows.length === 0) return;
  const stmts = rows.map((row) => buildUpsertStatement(table, row));
  const label =
    tableNo !== undefined && totalTables !== undefined && batchNo !== undefined && totalBatches !== undefined
      ? `[${tableNo}/${totalTables}] ${table} lote ${batchNo}/${totalBatches}`
      : `lote ${table}`;

  try {
    await withTimeout(client.batch(stmts, "write"), label);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Fallo al importar lote de ${table} (${rows.length} filas): ${detail}`);
  }
}

async function assertNoNaturalKeyConflict(
  sourceDb: Database.Database,
  client: Client,
  table: ImportTable,
  pageSize: number,
): Promise<void> {
  const check = NATURAL_KEY_CHECKS[table];
  if (!check) return;

  const targetByKey = await loadTargetNaturalKeys(client, table, check.columns, pageSize);
  const sourceRows = sourceDb.prepare(`SELECT * FROM ${table}`).all() as SourceRow[];

  for (const row of sourceRows) {
    if (table === "data_collection_runs" && row.status !== "running") continue;
    const key = naturalKey(row, check.columns);
    const targetId = targetByKey.get(key);
    if (targetId !== undefined && Number(targetId) !== Number(row.id)) {
      throw new Error(`Conflicto de clave única natural en ${table}`);
    }
  }
}

async function loadTargetNaturalKeys(
  client: Client,
  table: ImportTable,
  columns: string[],
  pageSize: number,
): Promise<Map<string, string | number>> {
  const byKey = new Map<string, string | number>();
  let lastId: string | number | null = null;
  const selectColumns = ["id", ...columns].join(", ");

  for (;;) {
    const result =
      lastId === null
        ? await withTimeout(client.execute(`SELECT ${selectColumns} FROM ${table} ORDER BY id LIMIT ${pageSize}`), `leer claves naturales de ${table}`)
        : await withTimeout(
            client.execute({
              sql: `SELECT ${selectColumns} FROM ${table} WHERE id > ? ORDER BY id LIMIT ${pageSize}`,
              args: [toSqlValue(lastId)],
            }),
            `leer claves naturales de ${table}`,
          );

    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      const id = row.id as string | number;
      const record: SourceRow = { id: id as string | number };
      for (const column of columns) {
        record[column] = (row[column] as string | number | null) ?? null;
      }
      if (table === "data_collection_runs" && record.status !== "running") {
        lastId = id;
        continue;
      }
      byKey.set(naturalKey(record, columns), id);
      lastId = id;
    }

    if (result.rows.length < pageSize) break;
  }

  return byKey;
}

function naturalKey(row: SourceRow, columns: string[]): string {
  return columns.map((column) => String(row[column])).join("\0");
}

function toSqlValue(value: unknown): SqlValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    value instanceof ArrayBuffer
  ) {
    return value;
  }
  throw new Error("Valor SQL no soportado durante importación");
}

async function verifyRelationships(client: Client): Promise<void> {
  const checks = [
    "SELECT COUNT(*) AS count FROM model_runs mr LEFT JOIN weather_stations ws ON ws.id = mr.station_id WHERE ws.id IS NULL",
    "SELECT COUNT(*) AS count FROM forecast_collections fc LEFT JOIN weather_stations ws ON ws.id = fc.station_id WHERE ws.id IS NULL",
    "SELECT COUNT(*) AS count FROM hourly_forecasts hf LEFT JOIN forecast_collections fc ON fc.id = hf.collection_id LEFT JOIN weather_stations ws ON ws.id = hf.station_id WHERE fc.id IS NULL OR ws.id IS NULL",
    "SELECT COUNT(*) AS count FROM hourly_observations ho LEFT JOIN weather_stations ws ON ws.id = ho.station_id WHERE ws.id IS NULL",
    "SELECT COUNT(*) AS count FROM data_collection_runs dcr LEFT JOIN weather_stations ws ON ws.id = dcr.station_id LEFT JOIN forecast_collections fc ON fc.id = dcr.forecast_collection_id WHERE ws.id IS NULL OR (dcr.forecast_collection_id IS NOT NULL AND fc.id IS NULL)",
  ];
  for (const check of checks) {
    const result = await withTimeout(client.execute(check), "verificar relaciones");
    if (Number(result.rows[0]?.count ?? 0) > 0) throw new Error("Importación dejó relaciones huérfanas");
  }
}

async function ensureAutoincrementSequences(client: Client): Promise<void> {
  for (const table of IMPORT_TABLES.filter((name) => name !== "weather_stations")) {
    const maxResult = await withTimeout(client.execute(`SELECT COALESCE(MAX(id), 0) AS max_id FROM ${table}`), `max id ${table}`);
    const maxId = Number(maxResult.rows[0]?.max_id ?? 0);
    if (maxId <= 0) continue;

    const seqResult = await withTimeout(
      client.execute({ sql: "SELECT seq FROM sqlite_sequence WHERE name = ?", args: [table] }),
      `leer sqlite_sequence ${table}`,
    );
    const currentSeq = seqResult.rows[0]?.seq;

    if (currentSeq === undefined) {
      await withTimeout(
        client.execute({ sql: "INSERT INTO sqlite_sequence(name, seq) VALUES(?, ?)", args: [table, maxId] }),
        `insertar sqlite_sequence ${table}`,
      );
    } else if (Number(currentSeq) < maxId) {
      await withTimeout(
        client.execute({ sql: "UPDATE sqlite_sequence SET seq = ? WHERE name = ?", args: [maxId, table] }),
        `actualizar sqlite_sequence ${table}`,
      );
    }
  }
}

async function verifyAutoincrementSequences(client: Client): Promise<void> {
  for (const table of IMPORT_TABLES.filter((name) => name !== "weather_stations")) {
    const result = await withTimeout(
      client.execute({
        sql: "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = ?), 0) AS seq, COALESCE((SELECT MAX(id) FROM " + table + "), 0) AS max_id",
        args: [table],
      }),
      `verificar secuencia ${table}`,
    );
    const row = result.rows[0];
    if (Number(row?.seq ?? 0) < Number(row?.max_id ?? 0)) throw new Error(`Secuencia autoincremental desfasada en ${table}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const source = args.find((arg) => arg.startsWith("--source="))?.slice("--source=".length);
  const target = args.find((arg) => arg.startsWith("--target="))?.slice("--target=".length);
  const dryRun = args.includes("--dry-run");

  if (!source || !target) {
    console.error("Uso: pnpm db:import-local-to-remote --source=file:./data/weather.db --target=libsql://... [--dry-run]");
    process.exit(1);
  }
  if (source === target) throw new Error("Origen y destino deben ser distintos");
  if (!source.startsWith("file:")) throw new Error("--source debe usar file:");
  if (!target.startsWith("libsql:") && process.env.ALLOW_FILE_IMPORT_TARGET !== "1") throw new Error("--target debe usar libsql:");

  const config = loadConfig({ ...process.env, DATABASE_URL: target });
  const sourceDb = new Database(sqlitePathFromDatabaseUrl(source), { readonly: true });
  const targetClient = createClient({
    url: target,
    authToken: config.TURSO_AUTH_TOKEN ?? "",
    fetch: createTimeoutFetch(REMOTE_TIMEOUT_MS),
  });

  try {
    logProgress(dryRun ? "Modo dry-run: sin escrituras" : "Modo importación real");
    const result = await importLocalToClient(sourceDb, targetClient, dryRun);
    console.log(JSON.stringify({ schemaVersion: 1, dryRun, tables: result }));
  } finally {
    sourceDb.close();
    targetClient.close();
  }
}

function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const signal = init?.signal;
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

const isDirectRun = process.argv[1]?.includes("db-import-local-to-remote") ?? false;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
