import "dotenv/config";
import { z } from "zod";
import { OPEN_METEO_MODELS, type OpenMeteoModel } from "./open-meteo/models.js";

const envSchema = z.object({
  AEMET_API_KEY: z.string().default(""),
  DATABASE_URL: z.string().min(1).default("file:./data/weather.db"),
  TURSO_AUTH_TOKEN: z.string().optional(),
  TIMEZONE: z.string().min(1).default("Europe/Madrid"),
  OPEN_METEO_MODELS: z.string().optional(),
  OPEN_METEO_REQUIRED_MODELS: z.string().optional(),
  OPEN_METEO_OPTIONAL_MODELS: z.string().optional(),
  FORECAST_MINIMUM_LEAD_MINUTES: z.coerce.number().int().min(0).default(30),
  COLLECTION_LOCK_TIMEOUT_MINUTES: z.coerce.number().int().min(1).default(30),
  FORECAST_STALE_AFTER_HOURS: z.coerce.number().min(0).default(12),
  OBSERVATION_STALE_AFTER_HOURS: z.coerce.number().min(0).default(6),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = envSchema.parse(env);
  validateDatabaseConfig(config);
  return config;
}

export type DatabaseKind = "sqlite" | "libsql";

export function databaseKind(databaseUrl: string): DatabaseKind {
  if (databaseUrl.startsWith("file:")) return "sqlite";
  if (databaseUrl.startsWith("libsql:")) return "libsql";
  throw new Error("DATABASE_URL debe empezar por file: o libsql:");
}

export function validateDatabaseConfig(config: AppConfig): void {
  const kind = databaseKind(config.DATABASE_URL);
  if (kind === "libsql" && (!config.TURSO_AUTH_TOKEN || config.TURSO_AUTH_TOKEN.trim().length === 0)) {
    throw new Error("TURSO_AUTH_TOKEN es obligatorio cuando DATABASE_URL usa libsql:");
  }
}

export function sqlitePathFromDatabaseUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL debe usar el formato file:./ruta/weather.db");
  }

  return databaseUrl.slice("file:".length);
}

export function requireAemetApiKey(config: AppConfig): string {
  if (config.AEMET_API_KEY.trim().length === 0) {
    throw new Error("AEMET_API_KEY es obligatoria para consultar AEMET");
  }

  return config.AEMET_API_KEY;
}

export function resolveOpenMeteoModels(config: AppConfig): OpenMeteoModel[] {
  if (!config.OPEN_METEO_MODELS || config.OPEN_METEO_MODELS.trim().length === 0) {
    return [...OPEN_METEO_MODELS];
  }

  const requested = config.OPEN_METEO_MODELS.split(",").map((model) => model.trim()).filter(Boolean);
  const allowed = new Set<string>(OPEN_METEO_MODELS);
  const invalid = requested.filter((model) => !allowed.has(model));
  if (invalid.length > 0) {
    throw new Error(`OPEN_METEO_MODELS contiene modelos no permitidos: ${invalid.join(", ")}`);
  }

  return requested as OpenMeteoModel[];
}

export interface OpenMeteoModelConfig {
  required: OpenMeteoModel[];
  optional: OpenMeteoModel[];
  all: OpenMeteoModel[];
}

export function resolveOpenMeteoModelConfig(config: AppConfig): OpenMeteoModelConfig {
  const required = parseModelList(config.OPEN_METEO_REQUIRED_MODELS ?? "ecmwf_ifs025,gfs_global,icon_global,gem_global,cma_grapes_global", "OPEN_METEO_REQUIRED_MODELS");
  const optional = parseModelList(config.OPEN_METEO_OPTIONAL_MODELS ?? "ecmwf_aifs025", "OPEN_METEO_OPTIONAL_MODELS");
  const duplicated = required.filter((model) => optional.includes(model));
  if (duplicated.length > 0) {
    throw new Error(`Modelos repetidos entre required y optional: ${duplicated.join(", ")}`);
  }
  return { required, optional, all: [...required, ...optional] };
}

function parseModelList(value: string, name: string): OpenMeteoModel[] {
  const requested = value.split(",").map((model) => model.trim()).filter(Boolean);
  const allowed = new Set<string>(OPEN_METEO_MODELS);
  const invalid = requested.filter((model) => !allowed.has(model));
  if (invalid.length > 0) {
    throw new Error(`${name} contiene modelos no permitidos: ${invalid.join(", ")}`);
  }
  return requested as OpenMeteoModel[];
}
