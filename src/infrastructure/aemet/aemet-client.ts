import { z } from "zod";
import type { WeatherStation } from "../../domain/weather-station.js";
import type { WeatherStationInventorySource } from "../../application/ports.js";
import type { JsonHttpClient } from "../http/http-client.js";
import { parseAemetCoordinate } from "./coordinates.js";
import { aemetMetadataSchema, parseAemetNullableNumber } from "./aemet-shared.js";

const AEMET_INVENTORY_URL = "https://opendata.aemet.es/opendata/api/valores/climatologicos/inventarioestaciones/todasestaciones";

const rawStationSchema = z.object({
  indicativo: z.string().min(1),
  nombre: z.string().min(1),
  provincia: z.string().min(1),
  latitud: z.union([z.string(), z.number()]),
  longitud: z.union([z.string(), z.number()]),
  altitud: z.union([z.string(), z.number()]).nullable().optional(),
});

const rawStationListSchema = z.array(rawStationSchema);

export class AemetClient implements WeatherStationInventorySource {
  constructor(
    private readonly httpClient: JsonHttpClient,
    private readonly apiKey: string,
  ) {}

  async fetchStations(): Promise<WeatherStation[]> {
    const metadataUrl = new URL(AEMET_INVENTORY_URL);
    metadataUrl.searchParams.set("api_key", this.apiKey);

    const metadata = aemetMetadataSchema.parse(await this.httpClient.getJson(metadataUrl.toString()));
    const rawStations = rawStationListSchema.parse(await this.httpClient.getJson(metadata.datos));
    return rawStations.map(normalizeAemetStation);
  }
}

export function normalizeAemetStation(raw: z.infer<typeof rawStationSchema>): WeatherStation {
  return {
    id: raw.indicativo.trim(),
    name: raw.nombre.trim(),
    province: raw.provincia.trim(),
    latitude: parseAemetCoordinate(raw.latitud),
    longitude: parseAemetCoordinate(raw.longitud),
    elevation: parseElevation(raw.altitud),
  };
}

function parseElevation(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return parseAemetNullableNumber(value);
}
