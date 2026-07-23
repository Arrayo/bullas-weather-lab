import { describe, expect, it } from "vitest";
import { parseAemetNullableNumber } from "../src/infrastructure/aemet/aemet-shared.js";
import { AemetObservationClient, normalizeAemetObservation } from "../src/infrastructure/aemet/aemet-observation-client.js";
import { parseAemetObservedAt } from "../src/infrastructure/aemet/aemet-time.js";

class FakeHttpClient {
  public readonly urls: string[] = [];

  constructor(private readonly responses: readonly unknown[]) {}

  async getJson(url: string): Promise<unknown> {
    this.urls.push(url);
    const response = this.responses[this.urls.length - 1];
    if (response === undefined) {
      throw new Error("Respuesta fake no configurada");
    }
    return response;
  }
}

describe("AemetObservationClient", () => {
  it("valida metadata y descarga la URL temporal datos", async () => {
    const http = new FakeHttpClient([
      { descripcion: "exito", estado: 200, datos: "https://datos.example.test/aemet.json" },
      [{ idema: "7127X", fint: "2026-07-21T23:00:00+0000", ta: "26,1", hr: "60", prec: "0" }],
    ]);
    const client = new AemetObservationClient(http, "secret", "Europe/Madrid");

    const observations = await client.fetchLatestObservations("7127X", new Date("2026-07-22T11:00:00.000Z"));

    expect(http.urls).toHaveLength(2);
    expect(new URL(http.urls[0] ?? "").searchParams.get("api_key")).toBe("secret");
    expect(http.urls[1]).toBe("https://datos.example.test/aemet.json");
    expect(observations).toHaveLength(1);
    expect(observations[0]?.temperature).toBe(26.1);
  });
});

describe("parseAemetNullableNumber", () => {
  it("normaliza números con coma y valores vacíos", () => {
    expect(parseAemetNullableNumber("12,5")).toBe(12.5);
    expect(parseAemetNullableNumber(7)).toBe(7);
    expect(parseAemetNullableNumber("")).toBeNull();
    expect(parseAemetNullableNumber(undefined)).toBeNull();
  });
});

describe("parseAemetObservedAt", () => {
  it("respeta fechas con offset explícito", () => {
    expect(parseAemetObservedAt("2026-07-21T23:00:00+0000", "Europe/Madrid").toISOString()).toBe("2026-07-21T23:00:00.000Z");
  });

  it("convierte fecha local Europe/Madrid de verano a UTC", () => {
    expect(parseAemetObservedAt("2026-07-22T12:00:00", "Europe/Madrid").toISOString()).toBe("2026-07-22T10:00:00.000Z");
  });

  it("convierte fecha local Europe/Madrid de invierno a UTC", () => {
    expect(parseAemetObservedAt("2026-01-22T12:00:00", "Europe/Madrid").toISOString()).toBe("2026-01-22T11:00:00.000Z");
  });
});

describe("normalizeAemetObservation", () => {
  it("normaliza campos reales y deja ausentes como null", () => {
    const observation = normalizeAemetObservation(
      { idema: "7127X", fint: "2026-07-21T23:00:00+0000", ta: "26,1", hr: "", prec: undefined },
      new Date("2026-07-22T11:00:00.000Z"),
      "Europe/Madrid",
    );

    expect(observation.temperature).toBe(26.1);
    expect(observation.relativeHumidity).toBeNull();
    expect(observation.precipitation).toBeNull();
    expect(observation.windSpeed).toBeNull();
  });
});
