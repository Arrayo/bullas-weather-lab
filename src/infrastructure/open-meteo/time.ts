export function zonedDateTimeToUtc(localDateTime: string, timeZone: string): Date {
  const [datePart, timePart] = localDateTime.split("T");
  if (!datePart || !timePart) {
    throw new Error(`Fecha horaria inválida: ${localDateTime}`);
  }

  const [year, month, day] = parseFixedParts(datePart, "-");
  const [hour, minute] = parseFixedParts(timePart, ":");
  if ([year, month, day, hour, minute].some((part) => !Number.isFinite(part))) {
    throw new Error(`Fecha horaria inválida: ${localDateTime}`);
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetMs = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offsetMs);
}

function parseFixedParts(value: string, separator: string): [number, number, number] {
  const parts = value.split(separator).map(Number);
  const [first, second, third = 0] = parts;
  if (first === undefined || second === undefined) {
    throw new Error(`Fecha horaria inválida: ${value}`);
  }

  return [first, second, third];
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return asUtc - date.getTime();
}
