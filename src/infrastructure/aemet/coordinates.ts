export function parseAemetCoordinate(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    throw new Error(`Coordenada AEMET inválida: ${String(value)}`);
  }

  const cleaned = value.trim().replace(",", ".").toUpperCase();
  const decimal = Number(cleaned);

  if (Number.isFinite(decimal)) {
    return decimal;
  }

  const dms = /^(\d{2,3})(\d{2})(\d{2})([NSEW])$/.exec(cleaned);

  if (!dms) {
    throw new Error(`Coordenada AEMET no soportada: ${value}`);
  }

  const [, degreesText, minutesText, secondsText, hemisphere] = dms;

  const degrees = Number(degreesText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);

  // Algunas estaciones de AEMET contienen valores como 162860W.
  // 16°28'60" equivale correctamente a 16°29'00".
  if (minutes > 60 || seconds > 60) {
    throw new Error(`Coordenada AEMET fuera de rango: ${value}`);
  }

  const absoluteDegrees =
    degrees +
    minutes / 60 +
    seconds / 3600;

  const maximumDegrees =
    hemisphere === "N" || hemisphere === "S"
      ? 90
      : 180;

  if (absoluteDegrees > maximumDegrees) {
    throw new Error(`Coordenada AEMET fuera de rango: ${value}`);
  }

  const sign =
    hemisphere === "S" || hemisphere === "W"
      ? -1
      : 1;

  return sign * absoluteDegrees;
}