import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/infrastructure/database/db.js";
import { applyMigrationsForTests, assertDatabaseMigrated, listMigrationFilesForTests } from "../src/infrastructure/database/migrate.js";

describe("database migrations", () => {
  it("detecta falta de data_collection_runs si solo se aplica hasta 0002", async () => {
    const db = createDb(join(mkdtempSync(join(tmpdir(), "bullas-weather-lab-")), "test.db"));
    for (const file of listMigrationFilesForTests().filter((name) => name < "0003")) {
      applySqlFile(db, file);
    }

    await expect(assertDatabaseMigrated(db)).rejects.toThrow("data_collection_runs");
  });

  it("no falla con todas las migraciones aplicadas", async () => {
    const db = createDb(join(mkdtempSync(join(tmpdir(), "bullas-weather-lab-")), "test.db"));
    applyMigrationsForTests(db);

    await expect(assertDatabaseMigrated(db)).resolves.toBeUndefined();
  });

  it("detecta tablas presentes con última migración pendiente", async () => {
    const db = createDb(join(mkdtempSync(join(tmpdir(), "bullas-weather-lab-")), "test.db"));
    applyMigrationsForTests(db);
    db.run("DELETE FROM __drizzle_migrations WHERE rowid = (SELECT MAX(rowid) FROM __drizzle_migrations)");

    await expect(assertDatabaseMigrated(db)).rejects.toThrow("migraciones pendientes");
  });

  it("descubre migraciones SQL en orden lexicográfico e ignora meta", () => {
    const files = listMigrationFilesForTests();

    expect(files).toEqual([...files].sort());
    expect(files.every((file) => file.endsWith(".sql"))).toBe(true);
    expect(files.some((file) => file.includes("meta"))).toBe(false);
  });
});

function applySqlFile(db: ReturnType<typeof createDb>, file: string): void {
  const sql = readFileSync(join(process.cwd(), "drizzle", file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
    db.run(statement);
  }
}
