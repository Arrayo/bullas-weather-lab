# Bullas Weather Lab

Base ejecutable para recopilar estaciones climatológicas de AEMET y predicciones horarias de varios modelos de Open-Meteo para una estación cercana a Bullas, Murcia.

Esta iteración no incluye frontend, despliegue, redes sociales, IA, calibración ni predicción combinada.

## Requisitos

- Node.js 22
- pnpm
- Clave de AEMET OpenData

## Instalación

```bash
pnpm install
cp .env.example .env
```

Edita `.env` y añade `AEMET_API_KEY`. No incluyas claves reales en el repositorio.

Puedes ajustar modelos con `OPEN_METEO_REQUIRED_MODELS` y `OPEN_METEO_OPTIONAL_MODELS`. Si no se definen, se usa la configuración segura por defecto.

## Scripts

Buscar y persistir estaciones candidatas relacionadas con Bullas o Murcia:

```bash
pnpm station:find
```

Recolectar predicciones para una estación ya persistida:

```bash
pnpm forecast:collect --station=<indicativo>
```

Mostrar comparativa de modelos para las próximas 48 horas:

```bash
pnpm forecast:report --station=<indicativo>
```

Recoger observaciones recientes de AEMET para una estación:

```bash
pnpm observation:collect --station=7127X
```

Mostrar las últimas 24 observaciones almacenadas, de más reciente a más antigua:

```bash
pnpm observation:report --station=7127X
```

Cruzar predicciones almacenadas con observaciones reales por hora UTC exacta:

```bash
pnpm forecast:verify --station=7127X --hours=48 --minimum-lead-minutes=30
```

También puedes filtrar por horizonte:

```bash
pnpm forecast:verify --station=7127X --hours=48 --min-lead-hours=6 --max-lead-hours=30
```

Calcular métricas básicas bajo demanda sobre verificaciones temporalmente válidas:

```bash
pnpm forecast:metrics --station=7127X
```

Calidad:

```bash
pnpm typecheck
pnpm test
pnpm lint
```

Drizzle:

```bash
pnpm db:generate
pnpm db:migrate
```

Los scripts de aplicación exigen que la base ya esté migrada. Ejecuta `pnpm db:migrate` antes de recoger datos.

## Base Local

Las migraciones Drizzle son la única fuente de verdad del esquema. Las migraciones ya generadas se tratan como inmutables: no se editan ni se sobrescriben; cualquier cambio nuevo debe añadirse en una migración nueva.

La aplicación comprueba en el arranque que la base esté migrada y no ejecuta `CREATE TABLE` ni `CREATE INDEX` completos desde los scripts.

Esta iteración cambia el esquema inicial: añade `forecast_collections`, `collection_id` en `hourly_forecasts` y separa `model_run_at` de `downloaded_at`.

Si tenías una base creada con la iteración anterior, no se migrará ni reinterpretará en silencio desde los scripts. En esta fase inicial, lo más simple es recrearla:

```bash
rm data/weather.db data/weather.db-* 2>/dev/null || true
pnpm db:migrate
pnpm station:find
```

Si necesitas conservar datos locales, haz primero una copia y prepara una migración manual específica.

## Ejecución Gratuita En GitHub Actions

GitHub Actions no conserva `data/weather.db` entre ejecuciones. Para recogida programada usa Turso/libSQL como base remota y deja SQLite solo para desarrollo local.

Variables locales:

```env
DATABASE_URL=file:./data/weather.db
AEMET_API_KEY=...
```

Secrets necesarios en GitHub:

- `TURSO_DATABASE_URL`: URL `libsql://...` de Turso.
- `TURSO_AUTH_TOKEN`: token de acceso a esa base.
- `AEMET_API_KEY`: clave de AEMET OpenData.

Flujo controlado para validar Turso antes de activar recogida programada:

```bash
DATABASE_URL="$TURSO_DATABASE_URL" \
TURSO_AUTH_TOKEN="$TURSO_AUTH_TOKEN" \
pnpm db:migrate

DATABASE_URL="$TURSO_DATABASE_URL" \
TURSO_AUTH_TOKEN="$TURSO_AUTH_TOKEN" \
AEMET_API_KEY="$AEMET_API_KEY" \
pnpm data:preflight --station=7127X --json
```

Después, revisa el import en seco:

```bash
pnpm db:import-local-to-remote \
  --source=file:./data/weather.db \
  --target="$TURSO_DATABASE_URL" \
  --dry-run
```

Ejecuta la importación real únicamente con confirmación explícita:

```bash
DATABASE_URL="$TURSO_DATABASE_URL" \
TURSO_AUTH_TOKEN="$TURSO_AUTH_TOKEN" \
pnpm db:import-local-to-remote \
  --source=file:./data/weather.db \
  --target="$TURSO_DATABASE_URL"
```

El importador aplica migraciones oficiales al destino, importa `weather_stations`, `model_runs`, `forecast_collections`, `hourly_forecasts`, `hourly_observations`, `job_executions` y `data_collection_runs`, valida relaciones y comprueba secuencias autoincrementales. No imprime secretos.

Antes de reactivar schedule, valida manualmente:

```bash
DATABASE_URL="$TURSO_DATABASE_URL" TURSO_AUTH_TOKEN="$TURSO_AUTH_TOKEN" AEMET_API_KEY="$AEMET_API_KEY" pnpm data:collect --station=7127X
DATABASE_URL="$TURSO_DATABASE_URL" TURSO_AUTH_TOKEN="$TURSO_AUTH_TOKEN" AEMET_API_KEY="$AEMET_API_KEY" pnpm data:health --station=7127X
```

Repite una segunda ejecución manual y confirma que los conteos persisten entre ejecuciones.

Workflows incluidos:

- `ci.yml`: instala, migra SQLite local, ejecuta typecheck, tests y lint.
- `weather-collect.yml`: migra Turso y ejecuta `data:collect` para `7127X`, pero temporalmente solo con `workflow_dispatch`.
- `weather-metrics.yml`: genera métricas diarias como JSON diagnóstico.
- `database-backup.yml`: comprueba estado remoto y sube solo diagnóstico JSON, no archivos `.db`.

Los workflows usan `permissions: contents: read`, no hacen commits ni push. Turso es la fuente de verdad de persistencia; los artefactos son diagnósticos temporales.

Para reactivar la recogida programada, edita `.github/workflows/weather-collect.yml` y descomenta:

```yaml
schedule:
  - cron: "17 */3 * * *"
```

## Decisiones

- La API key de AEMET se pasa solo como query parameter y se redacta en errores HTTP.
- Las coordenadas AEMET se normalizan desde decimal o DMS con hemisferio.
- Las fechas se guardan como ISO UTC en SQLite.
- Open-Meteo se consulta con `timezone=Europe/Madrid` y las horas locales recibidas se convierten a UTC antes de persistir.
- Los modelos de Open-Meteo están centralizados en `src/infrastructure/open-meteo/models.ts`.
- Cada `forecast:collect` crea una fila en `forecast_collections`; los informes usan la colección más reciente disponible por modelo.
- `model_run_at` queda en `null` hasta que Open-Meteo proporcione un timestamp oficial fiable; `downloaded_at` conserva el instante real de descarga.
- Un modelo Open-Meteo con todas sus variables meteorológicas en `null` se marca como fallo y no se persiste. AIFS permanece configurado para empezar a funcionar automáticamente si Open-Meteo devuelve datos útiles en el futuro.

## Fechas Forecast

- `modelRunAt`: hora oficial de ejecución del modelo, solo si la fuente la proporciona de forma fiable. Actualmente Open-Meteo Forecast API no la devuelve por modelo, por lo que se guarda como `null`.
- `downloadedAt`: hora UTC real en la que se descargó esa predicción concreta.
- `validAt`: hora UTC objetivo de la predicción.

La verificación científica exige que la predicción estuviera disponible antes de la observación:

```text
downloaded_at <= valid_at - minimum_lead_minutes
```

El valor por defecto es `FORECAST_MINIMUM_LEAD_MINUTES=30`. El argumento `--minimum-lead-minutes` sobrescribe ese valor para `forecast:verify` y `forecast:metrics`.

Para cada `station_id + model + valid_at`, se elige la predicción válida más reciente según:

```sql
ROW_NUMBER() OVER (
  PARTITION BY station_id, model, valid_at
  ORDER BY downloaded_at DESC, collection_id DESC
)
```

Los forecasts retrospectivos se conservan en la base, pero no se usan para verificación ni métricas.

## Métricas

Las métricas se calculan bajo demanda, no se persisten todavía.

Fórmulas:

- `error = forecast - observation`
- `ME = media(error)`
- `MAE = media(abs(error))`
- `RMSE = sqrt(media(error²))`

Si forecast u observación son `null`, solo se ignora esa variable concreta. No se reemplaza `null` por cero.

Buckets de horizonte: `0-6 h`, `6-12 h`, `12-24 h`, `24-48 h`, `48-72 h`, `72-120 h`, `120-168 h`. El límite inferior está incluido y el superior excluido: `[min, max)`.

No se publican métricas para un modelo/bucket/variable con menos de 5 muestras válidas; se muestra `muestras insuficientes`.

## Recogida Continua

### Puesta en marcha continua

```bash
pnpm db:migrate
pnpm station:find
pnpm data:preflight --station=7127X
pnpm data:collect --station=7127X
pnpm data:health --station=7127X
pnpm cron:print --station=7127X
crontab -e
```

Después comprueba la ejecución con:

```bash
tail -f logs/data-collect.log
pnpm data:health --station=7127X
pnpm data:stats --station=7127X
pnpm forecast:metrics --station=7127X
```

No reinicies ni borres la base de datos. Las primeras métricas válidas aparecerán gradualmente cuando existan forecasts descargados antes de las observaciones reales.

Modelos requeridos y opcionales:

- `OPEN_METEO_REQUIRED_MODELS`: un fallo degrada la ronda.
- `OPEN_METEO_OPTIONAL_MODELS`: un fallo se registra como advertencia, pero no degrada si todo lo requerido funciona.
- AIFS (`ecmwf_aifs025`) queda como opcional por defecto mientras Open-Meteo devuelva todos sus campos vacíos.

Ejecuta una ronda completa de forecasts y observaciones:

```bash
pnpm data:collect --station=7127X
pnpm data:collect --station=7127X --json
```

Consulta salud operativa y estadísticas:

```bash
pnpm data:health --station=7127X
pnpm data:stats --station=7127X
```

Exit codes para `data:collect` y `data:health`:

- `0`: success o healthy;
- `1`: fallo técnico, fallo total o estado failure;
- `2`: partial_success o degraded;
- `3`: ejecución omitida por bloqueo activo;
- `4`: datos stale en `data:health`.

`data:collect` usa un bloqueo persistente en SQLite: solo permite una ejecución `running` por estación. Si una ejecución queda bloqueada más de `COLLECTION_LOCK_TIMEOUT_MINUTES`, la siguiente ronda la marca como `failure` y continúa.

Ejemplo cron recomendado cada 3 horas:

```cron
7 */3 * * * cd /ruta/bullas-weather-lab && /ruta/pnpm data:collect --station=7127X >> logs/data-collect.log 2>&1
```

Ejecutar cada 3 horas genera snapshots suficientes para analizar horizontes, reduce llamadas innecesarias, vuelve a descargar las últimas observaciones AEMET y mantiene idempotencia.

Alternativa si se quieren observaciones más frecuentes conservando comandos individuales:

```cron
7 */6 * * * cd /ruta/bullas-weather-lab && /ruta/pnpm forecast:collect --station=7127X >> logs/forecast.log 2>&1
17 * * * * cd /ruta/bullas-weather-lab && /ruta/pnpm observation:collect --station=7127X >> logs/observations.log 2>&1
```

El directorio `logs/` está ignorado por git. No se implementa rotación propia; usa `logrotate` o la rotación del scheduler.

## Observaciones AEMET

Endpoint usado para observación convencional por estación:

```text
https://opendata.aemet.es/opendata/api/observacion/convencional/datos/estacion/{stationId}
```

Flujo aplicado:

- petición al endpoint con `api_key`;
- validación de metadata AEMET;
- descarga del JSON real desde `datos`;
- normalización y persistencia idempotente.

Campos reales encontrados para `7127X` en la respuesta inspeccionada:

- `idema`: indicativo de estación;
- `lon`: longitud;
- `fint`: fecha/hora de observación;
- `prec`: precipitación;
- `alt`: altitud;
- `lat`: latitud;
- `ubi`: nombre de ubicación;
- `hr`: humedad relativa;
- `tamin`: temperatura mínima del intervalo;
- `ta`: temperatura actual;
- `tamax`: temperatura máxima del intervalo.

Mapeo inicial al dominio:

- `idema` -> `stationId`;
- `fint` -> `observedAt` en UTC;
- `ta` -> `temperature`;
- `hr` -> `relativeHumidity`;
- `prec` -> `precipitation`;
- `vv` -> `windSpeed`, si AEMET lo devuelve;
- `dv` -> `windDirection`, si AEMET lo devuelve;
- `vmax` -> `windGust`, si AEMET lo devuelve;
- `pres` o `pres_nmar` -> `pressure`, si AEMET lo devuelve.

AEMET está respondiendo con `charset=ISO-8859-15`; el cliente HTTP decodifica según `charset` para conservar acentos correctamente.

Los valores numéricos se aceptan como número, string, string con coma decimal, vacío o ausente. Vacío y ausente se normalizan a `null`; formatos no numéricos no vacíos fallan de forma explícita.

Antes de guardar se validan mínimos de calidad: humedad 0-100, dirección viento 0-360, viento/racha/precipitación no negativos y temperatura entre -60 y 60 °C. Un valor imposible falla con `stationId`, `observedAt`, campo y valor.

Las observaciones disponibles dependen de AEMET y pueden cubrir menos de 24 horas. Si AEMET devuelve cero registros, la recogida se considera fallo.

## Limitaciones Pendientes

- Open-Meteo Forecast API no expone claramente el timestamp real de inicialización del modelo en esta respuesta; por ahora `model_run_at` se guarda como `null`.
- No hay calibración, observaciones históricas, selección automática de estación ni mezcla de modelos.
- `forecast:verify` solo cruza horas exactamente coincidentes; no interpola ni ajusta zonas horarias más allá de normalizar a UTC.
- Al principio puede no haber suficientes predicciones hechas con antelación para métricas fiables. No se rellenan métricas con forecasts retrospectivos.
