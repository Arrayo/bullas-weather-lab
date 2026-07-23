import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { drizzle as drizzleBetterSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { AppConfig } from "../config.js";
import { databaseKind, sqlitePathFromDatabaseUrl } from "../config.js";
import * as schema from "./schema.js";
import type { DatabaseHandle } from "./database-types.js";
import { createLibsqlExecutor, createSqliteExecutor } from "./database-adapter.js";

export function createDatabase(config: AppConfig): DatabaseHandle {
  const kind = databaseKind(config.DATABASE_URL);
  if (kind === "sqlite") {
    const path = sqlitePathFromDatabaseUrl(config.DATABASE_URL);
    mkdirSync(dirname(path), { recursive: true });
    const sqlite = new Database(path);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzleBetterSqlite(sqlite, { schema });
    const executor = createSqliteExecutor(db, () => { sqlite.close(); });
    return { kind, db: executor, close: executor.close };
  }

  const client = createClient({ url: config.DATABASE_URL, authToken: config.TURSO_AUTH_TOKEN ?? "" });
  const db = drizzleLibsql(client, { schema });
  const executor = createLibsqlExecutor(db, () => client.close());
  return { kind, db: executor, close: executor.close };
}
