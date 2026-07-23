import { describe, expect, it } from "vitest";
import { databaseKind, loadConfig } from "../src/infrastructure/config.js";

describe("database config", () => {
  it("selecciona sqlite para DATABASE_URL file:", () => {
    expect(databaseKind("file:./data/weather.db")).toBe("sqlite");
  });

  it("selecciona libsql para DATABASE_URL libsql:", () => {
    expect(databaseKind("libsql://example.turso.io")).toBe("libsql");
  });

  it("exige TURSO_AUTH_TOKEN cuando DATABASE_URL usa libsql:", () => {
    expect(() => loadConfig({ DATABASE_URL: "libsql://example.turso.io" })).toThrow("TURSO_AUTH_TOKEN");
  });

  it("rechaza protocolos de base de datos no soportados", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://example" })).toThrow("file: o libsql:");
  });
});
