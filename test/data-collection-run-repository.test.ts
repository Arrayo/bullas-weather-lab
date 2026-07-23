import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActiveCollectionRunError } from "../src/domain/data-collection-run.js";
import { createSqliteExecutor } from "../src/infrastructure/database/database-adapter.js";
import { createDb } from "../src/infrastructure/database/db.js";
import { applyMigrationsForTests } from "../src/infrastructure/database/migrate.js";
import { DrizzleDataCollectionRunRepository, DrizzleWeatherStationRepository } from "../src/infrastructure/database/repositories.js";

describe("DrizzleDataCollectionRunRepository", () => {
  it("bloquea una segunda ejecución activa", async () => {
    const repo = await createRepo();
    await repo.start("STATION", new Date("2026-07-22T10:00:00.000Z"), 30);

    await expect(repo.start("STATION", new Date("2026-07-22T10:01:00.000Z"), 30)).rejects.toBeInstanceOf(ActiveCollectionRunError);
  });

  it("recupera un bloqueo caducado y permite nueva ejecución", async () => {
    const repo = await createRepo();
    await repo.start("STATION", new Date("2026-07-22T10:00:00.000Z"), 30);

    const newRunId = await repo.start("STATION", new Date("2026-07-22T11:00:00.000Z"), 30);
    const latest = await repo.latest("STATION");

    expect(newRunId).toBe(2);
    expect(latest?.status).toBe("running");
    expect(await repo.countRunning("STATION")).toBe(1);
  });

  it("serializa y lee arrays JSON", async () => {
    const repo = await createRepo();
    const runId = await repo.start("STATION", new Date("2026-07-22T10:00:00.000Z"), 30);
    await repo.finish(runId, {
      status: "partial_success",
      forecastCollectionId: null,
      forecastSuccessfulModels: ["gfs_global"],
      forecastFailedModels: ["ecmwf_aifs025"],
      observationsReceived: 1,
      observationsInserted: 1,
      observationsUpdated: 0,
      errorMessages: ["aifs empty"],
      finishedAt: new Date("2026-07-22T10:01:00.000Z"),
    });

    const latest = await repo.latest("STATION");

    expect(latest?.forecastSuccessfulModels).toEqual(["gfs_global"]);
    expect(latest?.forecastFailedModels).toEqual(["ecmwf_aifs025"]);
    expect(latest?.errorMessages).toEqual(["aifs empty"]);
  });
});

async function createRepo() {
  const db = createDb(join(mkdtempSync(join(tmpdir(), "bullas-weather-lab-")), "test.db"));
  applyMigrationsForTests(db);
  const executor = createSqliteExecutor(db);
  await new DrizzleWeatherStationRepository(executor).saveMany([{ id: "STATION", name: "Station", province: "Murcia", latitude: 38, longitude: -1.5, elevation: null }]);
  return new DrizzleDataCollectionRunRepository(executor);
}
