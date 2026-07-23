import { z } from "zod";
import type { HourlyObservationSource } from "../../application/ports.js";
import type { HourlyObservation } from "../../domain/hourly-observation.js";
import type { JsonHttpClient } from "../http/http-client.js";
import { aemetMetadataSchema, parseAemetNullableNumber } from "./aemet-shared.js";
import { parseAemetObservedAt } from "./aemet-time.js";

const AEMET_OBSERVATION_URL = "https://opendata.aemet.es/opendata/api/observacion/convencional/datos/estacion";

const rawObservationSchema = z.object({
  idema: z.string().min(1),
  fint: z.string().min(1),
  ta: z.unknown().optional(),
  hr: z.unknown().optional(),
  prec: z.unknown().optional(),
  vv: z.unknown().optional(),
  dv: z.unknown().optional(),
  vmax: z.unknown().optional(),
  pres: z.unknown().optional(),
  pres_nmar: z.unknown().optional(),
}).passthrough();

const rawObservationListSchema = z.array(rawObservationSchema);

export class AemetObservationClient implements HourlyObservationSource {
  constructor(
    private readonly httpClient: JsonHttpClient,
    private readonly apiKey: string,
    private readonly timeZone: string,
  ) {}

  async fetchLatestObservations(stationId: string, downloadedAt: Date): Promise<HourlyObservation[]> {
    const metadataUrl = new URL(`${AEMET_OBSERVATION_URL}/${stationId}`);
    metadataUrl.searchParams.set("api_key", this.apiKey);

    const metadata = aemetMetadataSchema.parse(await this.httpClient.getJson(metadataUrl.toString()));
    const observations = rawObservationListSchema.parse(await this.httpClient.getJson(metadata.datos));
    return observations.map((observation) => normalizeAemetObservation(observation, downloadedAt, this.timeZone));
  }
}

export function normalizeAemetObservation(raw: z.infer<typeof rawObservationSchema>, downloadedAt: Date, timeZone: string): HourlyObservation {
  return {
    stationId: raw.idema.trim(),
    observedAt: parseAemetObservedAt(raw.fint, timeZone),
    downloadedAt,
    temperature: parseAemetNullableNumber(raw.ta),
    relativeHumidity: parseAemetNullableNumber(raw.hr),
    precipitation: parseAemetNullableNumber(raw.prec),
    windSpeed: parseAemetNullableNumber(raw.vv),
    windDirection: parseAemetNullableNumber(raw.dv),
    windGust: parseAemetNullableNumber(raw.vmax),
    pressure: parseAemetNullableNumber(raw.pres ?? raw.pres_nmar),
    source: "aemet",
  };
}

export const AEMET_OBSERVATION_ENDPOINT = `${AEMET_OBSERVATION_URL}/{stationId}`;
