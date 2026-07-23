import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import * as schema from "./schema.js";
import type { LocalDatabase } from "./database-types.js";

export function createDb(sqlitePath: string) {
  mkdirSync(dirname(sqlitePath), { recursive: true });
  const sqlite = new Database(sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export type AppDb = LocalDatabase;
