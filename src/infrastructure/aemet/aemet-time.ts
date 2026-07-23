import { zonedDateTimeToUtc } from "../open-meteo/time.js";

const OFFSET_PATTERN = /([+-]\d{2})(\d{2})$/;

export function parseAemetObservedAt(value: string, defaultTimeZone: string): Date {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Fecha AEMET vacía");
  }

  const normalizedOffset = trimmed.replace(OFFSET_PATTERN, "$1:$2");
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(normalizedOffset)) {
    const parsed = new Date(normalizedOffset);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Fecha AEMET inválida: ${value}`);
    }
    return parsed;
  }

  return zonedDateTimeToUtc(trimmed, defaultTimeZone);
}
