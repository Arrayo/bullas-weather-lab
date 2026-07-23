export class HttpError extends Error {
  constructor(
    message: string,
    public readonly details: { url: string; status?: number; attempt: number; cause?: unknown },
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface JsonHttpClient {
  getJson(url: string, init?: RequestInit): Promise<unknown>;
}

export interface HttpClientOptions {
  timeoutMs: number;
  maxAttempts: number;
  sleep?: (ms: number) => Promise<void>;
}

const TEMPORARY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403]);

export class HttpClient {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: HttpClientOptions) {
    this.sleep = options.sleep ?? defaultSleep;
  }

  async getJson(url: string, init?: RequestInit): Promise<unknown> {
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(url, init);
        if (!response.ok) {
          const safeUrl = sanitizeUrl(url);
          const status = response.status;
          const message = `GET ${safeUrl} falló con estado HTTP ${status}`;
          if (NON_RETRYABLE_STATUSES.has(status) || !TEMPORARY_STATUSES.has(status) || attempt === this.options.maxAttempts) {
            throw new HttpError(message, { url: safeUrl, status, attempt });
          }
          await this.sleep(delayForAttempt(attempt, response.headers.get("retry-after")));
          continue;
        }

        return JSON.parse(await decodeResponseText(response)) as unknown;
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }

        if (attempt === this.options.maxAttempts) {
          const safeUrl = sanitizeUrl(url);
          throw new HttpError(`GET ${safeUrl} falló tras ${attempt} intentos`, { url: safeUrl, attempt, cause: error });
        }

        await this.sleep(delayForAttempt(attempt));
      }
    }

    throw new HttpError("Petición HTTP agotada sin respuesta", { url: sanitizeUrl(url), attempt: this.options.maxAttempts });
  }

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function delayForAttempt(attempt: number, retryAfterHeader?: string | null): number {
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  if (retryAfterMs !== null) {
    return retryAfterMs;
  }

  return 500 * 2 ** (attempt - 1);
}

function parseRetryAfterMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 30) {
    return seconds * 1000;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const ms = date.getTime() - Date.now();
  if (ms >= 0 && ms <= 30_000) {
    return ms;
  }

  return null;
}

export function sanitizeUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.searchParams.has("api_key")) {
    parsed.searchParams.set("api_key", "[redacted]");
  }
  return parsed.toString();
}

export async function decodeResponseText(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  const charset = charsetFromContentType(contentType) ?? "utf-8";
  const bytes = await response.arrayBuffer();

  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function charsetFromContentType(contentType: string): string | null {
  const match = /charset=([^;]+)/i.exec(contentType);
  return match?.[1]?.trim() ?? null;
}
