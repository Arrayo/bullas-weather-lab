import { describe, expect, it } from "vitest";
import { normalizeAemetStation } from "../src/infrastructure/aemet/aemet-client.js";
import { parseAemetCoordinate } from "../src/infrastructure/aemet/coordinates.js";

describe("parseAemetCoordinate", () => {
  it("convierte coordenadas DMS con hemisferio", () => {
    expect(parseAemetCoordinate("382701N")).toBeCloseTo(38.450277, 5);
    expect(parseAemetCoordinate("0011433W")).toBeCloseTo(-1.2425, 6);
  });

  it("acepta coordenadas decimales en número o texto", () => {
    expect(parseAemetCoordinate(38.1)).toBe(38.1);
    expect(parseAemetCoordinate("-1,5")).toBe(-1.5);
  });

  it("rechaza formatos desconocidos", () => {
    expect(() => parseAemetCoordinate("38N")).toThrow("no soportada");
  });
});

describe("normalizeAemetStation", () => {
  it("normaliza campos relevantes del inventario", () => {
    const station = normalizeAemetStation({
      indicativo: " 7178I ",
      nombre: " BULLAS ",
      provincia: " MURCIA ",
      latitud: "382701N",
      longitud: "0011433W",
      altitud: "640",
    });

    expect(station).toMatchObject({
      id: "7178I",
      name: "BULLAS",
      province: "MURCIA",
      elevation: 640,
    });
    expect(station.latitude).toBeCloseTo(38.450277, 5);
    expect(station.longitude).toBeCloseTo(-1.2425, 6);
  });
});
