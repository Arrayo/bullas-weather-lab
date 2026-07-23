import { migrate as migrateBetterSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { migrate as migrateLibsql } from "drizzle-orm/libsql/migrator";
import { createDatabase } from "../infrastructure/database/database-factory.js";
import { loadConfig } from "../infrastructure/config.js";

const config = loadConfig();
const database = createDatabase(config);

try {
  if (database.kind === "sqlite") {
    migrateBetterSqlite(database.db.raw, { migrationsFolder: "drizzle" });
  } else {
    await migrateLibsql(database.db.raw as never, { migrationsFolder: "drizzle" });
  }
  console.log("Migraciones aplicadas correctamente");
} finally {
  await database.close();
}
