import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["AEMET_API_KEY", "TURSO_AUTH_TOKEN", "api_key", "authToken", "req.headers.authorization"],
});
