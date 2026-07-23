import { describe, expect, it, vi } from "vitest";
import { decodeResponseText, delayForAttempt, HttpClient, HttpError, sanitizeUrl } from "../src/infrastructure/http/http-client.js";

describe("sanitizeUrl", () => {
  it("oculta api_key", () => {
    expect(sanitizeUrl("https://example.test/path?api_key=secret&x=1")).toBe("https://example.test/path?api_key=%5Bredacted%5D&x=1");
  });
});

describe("HttpClient", () => {
  it("no reintenta errores 401", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const waits: number[] = [];
    const client = new HttpClient({ timeoutMs: 100, maxAttempts: 3, sleep: async (ms) => { waits.push(ms); } });

    await expect(client.getJson("https://example.test?api_key=secret")).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
    fetchMock.mockRestore();
  });

  it("reintenta un 500 con espera exponencial hasta tener respuesta válida", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const waits: number[] = [];
    const client = new HttpClient({ timeoutMs: 100, maxAttempts: 3, sleep: async (ms) => { waits.push(ms); } });

    await expect(client.getJson("https://example.test/data")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([500]);
    fetchMock.mockRestore();
  });

  it("agota los tres intentos en errores temporales", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 503 }));
    const waits: number[] = [];
    const client = new HttpClient({ timeoutMs: 100, maxAttempts: 3, sleep: async (ms) => { waits.push(ms); } });

    await expect(client.getJson("https://example.test/data")).rejects.toMatchObject({ details: { status: 503, attempt: 3 } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([500, 1000]);
    fetchMock.mockRestore();
  });

  it("respeta Retry-After razonable", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const waits: number[] = [];
    const client = new HttpClient({ timeoutMs: 100, maxAttempts: 3, sleep: async (ms) => { waits.push(ms); } });

    await expect(client.getJson("https://example.test/data")).resolves.toEqual({ ok: true });
    expect(waits).toEqual([2000]);
    fetchMock.mockRestore();
  });
});

describe("delayForAttempt", () => {
  it("ignora Retry-After no razonable", () => {
    expect(delayForAttempt(2, "120")).toBe(1000);
  });
});

describe("decodeResponseText", () => {
  it("decodifica respuestas ISO-8859-15 de AEMET con acentos", async () => {
    const bytes = new Uint8Array([0xc1, 0x47, 0x55, 0x49, 0x4c, 0x41, 0x53]);
    const response = new Response(bytes, { headers: { "content-type": "text/plain;charset=ISO-8859-15" } });

    await expect(decodeResponseText(response)).resolves.toBe("ÁGUILAS");
  });
});
