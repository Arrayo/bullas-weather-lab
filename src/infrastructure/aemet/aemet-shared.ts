import { z } from "zod";

export const aemetMetadataSchema = z.object({
  descripcion: z.string().optional(),
  estado: z.number(),
  datos: z.string().url(),
  metadatos: z.string().url().optional(),
});

export function parseAemetNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Número AEMET inválido: ${String(value)}`);
    }
    return value;
  }

  if (typeof value !== "string") {
    throw new Error(`Número AEMET inválido: ${String(value)}`);
  }

  const parsed = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Número AEMET inválido: ${value}`);
  }

  return parsed;
}
