import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client, type InStatement, type TransactionMode } from "@libsql/client";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../src/infrastructure/database/db.js";
import { applyMigrationsForTests } from "../src/infrastructure/database/migrate.js";
import {
  BATCH_SIZE,
  chunkRows,
  countInsertUpdate,
  importLocalToClient,
  loadTargetIdSet,
  upsertRowsBatch,
} from "../src/scripts/db-import-local-to-remote.js";

const tables = ["weather_stations", "model_runs", "forecast_collections", "hourly_forecasts", "hourly_observations", "job_executions", "data_collection_runs"];

describe("db import local to remote", () => {
  it("importa todas las tablas, migra destino y es idempotente", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bullas-weather-lab-import-"));
    const sourcePath = join(dir, "source.db");
    const targetPath = join(dir, "target.db");
    const db = createDb(sourcePath);
    applyMigrationsForTests(db);
    seedSource(db);

    const first = runImport(sourcePath, targetPath);
    const second = runImport(sourcePath, targetPath);

    for (const table of tables) {
      expect(first.tables[table]).toMatchObject({ sourceCount: 1, targetCountBefore: 0, inserted: 1, updated: 0, targetCountAfter: 1 });
      expect(second.tables[table]).toMatchObject({ sourceCount: 1, targetCountBefore: 1, inserted: 0, updated: 1, targetCountAfter: 1 });
    }
    await expectRelationsAndSequences(targetPath);
  });

  it("dry-run no escribe en el destino", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bullas-weather-lab-import-dry-"));
    const sourcePath = join(dir, "source.db");
    const targetPath = join(dir, "target.db");
    const db = createDb(sourcePath);
    applyMigrationsForTests(db);
    seedSource(db);

    const result = runImport(sourcePath, targetPath, true);

    expect(result.tables.weather_stations).toMatchObject({ sourceCount: 1, targetCountBefore: 0, inserted: 1, updated: 0, targetCountAfter: 0 });
  });

  it("dry-run no ejecuta una consulta por fila", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bullas-weather-lab-import-dry-queries-"));
    const sourcePath = join(dir, "source.db");
    const targetPath = join(dir, "target.db");
    const source = createDb(sourcePath);
    applyMigrationsForTests(source);
    seedManyHourlyForecasts(source, 250);

    const targetClient = createClient({ url: `file:${targetPath}` });
    const executeCalls: string[] = [];
    const proxied = proxyClient(targetClient, {
      onExecute(sql) {
        executeCalls.push(sql);
      },
      onBatch() {
        throw new Error("dry-run no debe llamar batch");
      },
    });

    try {
      const result = await importLocalToClient(new Database(sourcePath, { readonly: true }), proxied, true, { pageSize: 100 });
      expect(result.hourly_forecasts).toMatchObject({ sourceCount: 250, inserted: 250, updated: 0, targetCountAfter: 0 });

      const existenceChecks = executeCalls.filter((sql) => /SELECT 1 FROM hourly_forecasts WHERE id = \?/i.test(sql));
      expect(existenceChecks).toHaveLength(0);

      const idSelects = executeCalls.filter((sql) => /SELECT id FROM hourly_forecasts/i.test(sql));
      expect(idSelects.length).toBeGreaterThanOrEqual(1);
      expect(idSelects.length).toBeLessThan(250);
    } finally {
      targetClient.close();
    }
  });

  it("calcula inserted/updated en memoria con el Set de ids", () => {
    expect(countInsertUpdate([1, 2, 3], new Set(["2"]))).toEqual({ inserted: 2, updated: 1 });
    expect(countInsertUpdate(["A", "B"], new Set(["A", "B"]))).toEqual({ inserted: 0, updated: 2 });
  });

  it("una segunda importación no crea duplicados", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bullas-weather-lab-import-idem-"));
    const sourcePath = join(dir, "source.db");
    const targetPath = join(dir, "target.db");
    const db = createDb(sourcePath);
    applyMigrationsForTests(db);
    seedSource(db);

    runImport(sourcePath, targetPath);
    runImport(sourcePath, targetPath);

    const client = createClient({ url: `file:${targetPath}` });
    try {
      for (const table of tables) {
        const count = await client.execute(`SELECT COUNT(*) AS count FROM ${table}`);
        expect(Number(count.rows[0]?.count)).toBe(1);
      }
    } finally {
      client.close();
    }
  });

  it("el batching importa todas las filas", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bullas-weather-lab-import-batch-"));
    const sourcePath = join(dir, "source.db");
    const targetPath = join(dir, "target.db");
    const source = createDb(sourcePath);
    applyMigrationsForTests(source);
    seedManyHourlyForecasts(source, 450);

    const targetClient = createClient({ url: `file:${targetPath}` });
    const sourceDb = new Database(sourcePath, { readonly: true });
    try {
      const result = await importLocalToClient(sourceDb, targetClient, false, { batchSize: 100 });
      expect(result.hourly_forecasts).toMatchObject({ sourceCount: 450, inserted: 450, updated: 0, targetCountAfter: 450, batches: 5 });
      const count = await targetClient.execute("SELECT COUNT(*) AS count FROM hourly_forecasts");
      expect(Number(count.rows[0]?.count)).toBe(450);
    } finally {
      sourceDb.close();
      targetClient.close();
    }
  });

  it("una tabla con 6888 filas se divide correctamente en lotes", () => {
    const rows = Array.from({ length: 6888 }, (_, index) => index);
    const chunks = chunkRows(rows, BATCH_SIZE);
    expect(chunks).toHaveLength(Math.ceil(6888 / BATCH_SIZE));
    expect(chunks[0]).toHaveLength(BATCH_SIZE);
    expect(chunks.at(-1)).toHaveLength(6888 % BATCH_SIZE);
    expect(chunks.reduce((total, chunk) => total + chunk.length, 0)).toBe(6888);
  });

  it("un fallo en un lote produce un error claro y no se presenta como importación completa", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bullas-weather-lab-import-fail-"));
    const sourcePath = join(dir, "source.db");
    const targetPath = join(dir, "target.db");
    const source = createDb(sourcePath);
    applyMigrationsForTests(source);
    seedManyHourlyForecasts(source, 250);

    const targetClient = createClient({ url: `file:${targetPath}` });
    let hourlyBatches = 0;
    const proxied = proxyClient(targetClient, {
      onBatch(stmts) {
        const first = stmts[0];
        if (first === undefined) return;
        const sql = typeof first === "string" ? first : Array.isArray(first) ? first[0] : first.sql;
        if (!String(sql).includes("hourly_forecasts")) return;
        hourlyBatches += 1;
        if (hourlyBatches === 2) throw new Error("simulated batch failure");
      },
    });
    const sourceDb = new Database(sourcePath, { readonly: true });

    try {
      await expect(importLocalToClient(sourceDb, proxied, false, { batchSize: 100 })).rejects.toThrow(
        /Fallo al importar lote de hourly_forecasts \(100 filas\): simulated batch failure/,
      );
      expect(hourlyBatches).toBe(2);
    } finally {
      sourceDb.close();
      targetClient.close();
    }
  });

  it("loadTargetIdSet pagina sin consultas por id individual", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bullas-weather-lab-import-ids-"));
    const path = join(dir, "target.db");
    const db = createDb(path);
    applyMigrationsForTests(db);
    seedManyHourlyForecasts(db, 250);

    const client = createClient({ url: `file:${path}` });
    const executeCalls: string[] = [];
    const proxied = proxyClient(client, {
      onExecute(sql) {
        executeCalls.push(sql);
      },
    });

    try {
      const ids = await loadTargetIdSet(proxied, "hourly_forecasts", 100);
      expect(ids.size).toBe(250);
      expect(executeCalls.every((sql) => !/WHERE id = \? LIMIT 1/i.test(sql))).toBe(true);
      expect(executeCalls.filter((sql) => /SELECT id FROM hourly_forecasts/i.test(sql)).length).toBe(3);
    } finally {
      client.close();
    }
  });

  it("upsertRowsBatch propaga error con contexto de lote", async () => {
    const client = {
      batch: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as Client;

    await expect(upsertRowsBatch(client, "job_executions", [{ id: 1, job_name: "x", started_at: "t", finished_at: null, status: "success", message: null }])).rejects.toThrow(
      "Fallo al importar lote de job_executions (1 filas): boom",
    );
  });
});

function runImport(sourcePath: string, targetPath: string, dryRun = false) {
  const output = execFileSync(
    "pnpm",
    ["tsx", "src/scripts/db-import-local-to-remote.ts", `--source=file:${sourcePath}`, `--target=file:${targetPath}`, ...(dryRun ? ["--dry-run"] : [])],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ALLOW_FILE_IMPORT_TARGET: "1" },
    },
  );
  const jsonLine = output
    .trim()
    .split("\n")
    .reverse()
    .find((line) => line.startsWith("{"));
  if (!jsonLine) throw new Error(`No JSON output from import script: ${output}`);
  return JSON.parse(jsonLine) as {
    tables: Record<string, { sourceCount: number; targetCountBefore: number; inserted: number; updated: number; targetCountAfter: number }>;
  };
}

function seedSource(db: ReturnType<typeof createDb>): void {
  db.run("INSERT INTO weather_stations (id, name, province, latitude, longitude, elevation, updated_at) VALUES ('STATION', 'Station', 'Murcia', 38, -1.5, 700, '2026-07-22T00:00:00.000Z')");
  db.run("INSERT INTO model_runs (id, station_id, model, original_model, model_run_at, downloaded_at) VALUES (10, 'STATION', 'gfs_global', 'gfs_global', NULL, '2026-07-22T01:00:00.000Z')");
  db.run("INSERT INTO forecast_collections (id, station_id, started_at, finished_at, status, successful_models, failed_models) VALUES (20, 'STATION', '2026-07-22T01:00:00.000Z', '2026-07-22T01:01:00.000Z', 'success', '[\"gfs_global\"]', '[]')");
  db.run("INSERT INTO hourly_forecasts (id, collection_id, station_id, model, model_run_at, valid_at, downloaded_at, temperature_2m, relative_humidity_2m, precipitation, wind_speed_10m, wind_direction_10m, cloud_cover) VALUES (30, 20, 'STATION', 'gfs_global', NULL, '2026-07-22T10:00:00.000Z', '2026-07-22T01:00:00.000Z', 30, 50, 0, 10, 180, 20)");
  db.run("INSERT INTO hourly_observations (id, station_id, observed_at, downloaded_at, temperature, relative_humidity, precipitation, wind_speed, wind_direction, wind_gust, pressure, source) VALUES (40, 'STATION', '2026-07-22T10:00:00.000Z', '2026-07-22T11:00:00.000Z', 29, 51, 0, 9, 190, 12, 1010, 'aemet')");
  db.run("INSERT INTO job_executions (id, job_name, started_at, finished_at, status, message) VALUES (50, 'test', '2026-07-22T01:00:00.000Z', '2026-07-22T01:01:00.000Z', 'success', NULL)");
  db.run(
    "INSERT INTO data_collection_runs (id, station_id, started_at, finished_at, duration_ms, status, forecast_collection_id, forecast_successful_models, forecast_failed_models, required_models_successful, required_models_failed, optional_models_successful, optional_models_failed, observations_received, observations_inserted, observations_updated, error_messages) VALUES (60, 'STATION', '2026-07-22T01:00:00.000Z', '2026-07-22T01:01:00.000Z', 60000, 'success', 20, '[\"gfs_global\"]', '[]', '[\"gfs_global\"]', '[]', '[]', '[]', 1, 1, 0, '[]')",
  );
}

function seedManyHourlyForecasts(db: ReturnType<typeof createDb>, count: number): void {
  db.run("INSERT INTO weather_stations (id, name, province, latitude, longitude, elevation, updated_at) VALUES ('STATION', 'Station', 'Murcia', 38, -1.5, 700, '2026-07-22T00:00:00.000Z')");
  db.run("INSERT INTO forecast_collections (id, station_id, started_at, finished_at, status, successful_models, failed_models) VALUES (20, 'STATION', '2026-07-22T01:00:00.000Z', '2026-07-22T01:01:00.000Z', 'success', '[\"gfs_global\"]', '[]')");
  const sqlite = db.$client;
  const insert = sqlite.prepare(
    "INSERT INTO hourly_forecasts (id, collection_id, station_id, model, model_run_at, valid_at, downloaded_at, temperature_2m, relative_humidity_2m, precipitation, wind_speed_10m, wind_direction_10m, cloud_cover) VALUES (?, 20, 'STATION', 'gfs_global', NULL, ?, '2026-07-22T01:00:00.000Z', 30, 50, 0, 10, 180, 20)",
  );
  const tx = sqlite.transaction(() => {
    for (let index = 1; index <= count; index += 1) {
      const at = new Date(Date.UTC(2026, 6, 22, 0, index)).toISOString();
      insert.run(index, at);
    }
  });
  tx();
}

function proxyClient(
  client: Client,
  hooks: {
    onExecute?: (sql: string) => void;
    onBatch?: (stmts: Array<InStatement | [string, unknown?]>) => void;
  },
): Client {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "execute") {
        return async (stmtOrSql: InStatement | string, args?: unknown) => {
          const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
          hooks.onExecute?.(sql);
          return target.execute(stmtOrSql as never, args as never);
        };
      }
      if (prop === "batch") {
        return async (stmts: Array<InStatement | [string, unknown?]>, mode?: TransactionMode) => {
          hooks.onBatch?.(stmts);
          return target.batch(stmts as never, mode);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function expectRelationsAndSequences(targetPath: string): Promise<void> {
  const client = createClient({ url: `file:${targetPath}` });
  try {
    const relations = await client.execute(
      "SELECT hf.collection_id, dcr.forecast_collection_id FROM hourly_forecasts hf INNER JOIN data_collection_runs dcr ON dcr.forecast_collection_id = hf.collection_id",
    );
    expect(relations.rows).toHaveLength(1);
    const insert = await client.execute(
      "INSERT INTO forecast_collections (station_id, started_at, finished_at, status, successful_models, failed_models) VALUES ('STATION', '2026-07-23T00:00:00.000Z', NULL, 'failure', '[]', '[]') RETURNING id",
    );
    expect(Number(insert.rows[0]?.id)).toBeGreaterThan(20);
  } finally {
    client.close();
  }
}
