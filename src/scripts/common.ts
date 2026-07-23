import type { SQLWrapper } from "drizzle-orm";
import { AemetClient } from "../infrastructure/aemet/aemet-client.js";
import { AemetObservationClient } from "../infrastructure/aemet/aemet-observation-client.js";
import { loadConfig, requireAemetApiKey } from "../infrastructure/config.js";
import { assertDatabaseMigrated } from "../infrastructure/database/migrate.js";
import { createDatabase } from "../infrastructure/database/database-factory.js";
import type { DatabaseExecutor } from "../infrastructure/database/database-types.js";
import { DrizzleDataCollectionRunRepository, DrizzleForecastRepository, DrizzleHourlyObservationRepository, DrizzleWeatherStationRepository } from "../infrastructure/database/repositories.js";
import { HttpClient } from "../infrastructure/http/http-client.js";
import { OpenMeteoClient } from "../infrastructure/open-meteo/open-meteo-client.js";

export async function createApp() {
  const config = loadConfig();
  const database = createDatabase(config);
  const db = database.db;
  await assertDatabaseMigrated(db.raw);
  const httpClient = new HttpClient({ timeoutMs: 10_000, maxAttempts: 3 });

  return {
    config,
    db,
    createAemetClient: () => new AemetClient(httpClient, requireAemetApiKey(config)),
    createAemetObservationClient: () => new AemetObservationClient(httpClient, requireAemetApiKey(config), config.TIMEZONE),
    openMeteoClient: new OpenMeteoClient(httpClient, config.TIMEZONE),
    stationRepository: new DrizzleWeatherStationRepository(db),
    forecastRepository: new DrizzleForecastRepository(db),
    observationRepository: new DrizzleHourlyObservationRepository(db),
    dataCollectionRepository: new DrizzleDataCollectionRunRepository(db),
  };
}

export function hasJsonFlag(args: readonly string[]): boolean {
  return args.includes("--json");
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export async function queryAll<T>(db: DatabaseExecutor, query: SQLWrapper): Promise<T[]> {
  return await db.raw.all(query) as T[];
}

export function readStationIdFromArgs(args: readonly string[]): string | null {
  const stationArg = args.find((arg) => arg.startsWith("--station="));
  return stationArg?.slice("--station=".length).trim() || null;
}

export function readHoursFromArgs(args: readonly string[], defaultHours: number): number {
  const hoursArg = args.find((arg) => arg.startsWith("--hours="));
  if (!hoursArg) {
    return defaultHours;
  }

  const parsed = Number(hoursArg.slice("--hours=".length));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--hours debe ser un entero positivo");
  }

  return parsed;
}

export function readOptionalNumberArg(args: readonly string[], name: string): number | undefined {
  const arg = args.find((value) => value.startsWith(`--${name}=`));
  if (!arg) {
    return undefined;
  }

  const parsed = Number(arg.slice(name.length + 3));
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} debe ser numérico`);
  }

  return parsed;
}

export function readNonNegativeIntegerArg(args: readonly string[], name: string, defaultValue: number): number {
  const value = readOptionalNumberArg(args, name) ?? defaultValue;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} debe ser un entero mayor o igual que cero`);
  }

  return value;
}

export function readNonNegativeNumberArg(args: readonly string[], name: string): number | undefined {
  const value = readOptionalNumberArg(args, name);
  if (value !== undefined && value < 0) {
    throw new Error(`--${name} debe ser mayor o igual que cero`);
  }

  return value;
}
