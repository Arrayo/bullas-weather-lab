import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "./schema.js";
import type { HourlyForecast } from "../../domain/hourly-forecast.js";

export type LocalDatabase = BetterSQLite3Database<typeof schema>;
export type RemoteDatabase = LibSQLDatabase<typeof schema>;
export type AppDb = LocalDatabase | RemoteDatabase;

export interface DatabaseExecutor {
  kind: "sqlite" | "libsql";
  raw: LocalDatabase;
  insertForecastBatch(forecasts: HourlyForecast[], originalModel: string): Promise<void>;
  close(): void | Promise<void>;
}

export interface DatabaseHandle {
  kind: "sqlite" | "libsql";
  db: DatabaseExecutor;
  close(): void | Promise<void>;
}
