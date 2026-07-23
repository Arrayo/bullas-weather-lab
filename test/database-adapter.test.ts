import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { describe, expect, it } from "vitest";
import { ActiveCollectionRunError } from "../src/domain/data-collection-run.js";
import { createLibsqlExecutor, createSqliteExecutor } from "../src/infrastructure/database/database-adapter.js";
import { createDb } from "../src/infrastructure/database/db.js";
import { applyMigrationsForTests } from "../src/infrastructure/database/migrate.js";
import { DrizzleDataCollectionRunRepository, DrizzleWeatherStationRepository } from "../src/infrastructure/database/repositories.js";
import * as schema from "../src/infrastructure/database/schema.js";

describe("database adapters", () => {
  it("adaptador local expone operaciones comunes", async () => {
    const db = createDb(join(mkdtempSync(join(tmpdir(), "bullas-weather-lab-adapter-")), "test.db"));
    applyMigrationsForTests(db);
    const executor = createSqliteExecutor(db);

    await new DrizzleWeatherStationRepository(executor).saveMany([{ id: "STATION", name: "Station", province: "Murcia", latitude: 38, longitude: -1.5, elevation: null }]);

    expect(executor.kind).toBe("sqlite");
    expect(await new DrizzleWeatherStationRepository(executor).findById("STATION")).toMatchObject({ id: "STATION" });
  });

  it("adaptador libSQL simulado bloquea ejecuciones concurrentes sin exponer SQL", async () => {
    const { executor, close } = await createLocalLibsqlExecutor();
    try {
      await new DrizzleWeatherStationRepository(executor).saveMany([{ id: "STATION", name: "Station", province: "Murcia", latitude: 38, longitude: -1.5, elevation: null }]);
      const runs = new DrizzleDataCollectionRunRepository(executor);

      const results = await Promise.allSettled([
        runs.start("STATION", new Date("2026-07-22T10:00:00.000Z"), 30),
        runs.start("STATION", new Date("2026-07-22T10:00:00.000Z"), 30),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" ? rejected.reason : null).toBeInstanceOf(ActiveCollectionRunError);
      expect(rejected?.status === "rejected" ? String(rejected.reason.message) : "").not.toMatch(/SQLITE|constraint|unique/i);
      expect(await runs.countRunning("STATION")).toBe(1);
      const script = readFileSync(join(process.cwd(), "src", "scripts", "data-collect.ts"), "utf8");
      expect(script).toContain("error instanceof ActiveCollectionRunError");
      expect(script).toContain("process.exitCode = 3");
    } finally {
      close();
    }
  });

  it("no expone any público en persistencia", () => {
    const types = readFileSync(join(process.cwd(), "src", "infrastructure", "database", "database-types.ts"), "utf8");
    expect(types).not.toMatch(/export\s+type\s+\w+\s*=\s*any/);
    expect(types).not.toContain("QueryDatabase");
  });
});

async function createLocalLibsqlExecutor() {
  const dbPath = join(mkdtempSync(join(tmpdir(), "bullas-weather-lab-libsql-")), "test.db");
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return { executor: createLibsqlExecutor(db, () => client.close()), close: () => client.close() };
}
