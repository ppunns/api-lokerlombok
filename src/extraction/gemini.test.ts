import { describe, expect, test } from "bun:test";
import { createGeminiExtractor, GeminiApiError, withFallback, type Extraction, type Extractor } from "./gemini";

const extraction: Extraction = {
  is_job_post: true,
  ocr_text: "WE ARE HIRING KASIR",
  jobs: [
    {
      title: "Kasir",
      company_name: null,
      location: "Mataram",
      regencies: ["kota_mataram"],
      description: null,
      requirements: ["SMA/SMK"],
      employment_type: null,
      education_level: "sma_smk",
      salary_min: null,
      salary_max: null,
      salary_text: null,
      deadline: null,
    },
  ],
};

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = (output: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] });
const input = {
  caption: "Hai Semeton",
  postedAt: new Date("2026-10-25T11:50:30Z"),
  images: [{ mimeType: "image/jpeg", data: "QUJD" }],
};

describe("createGeminiExtractor", () => {
  test("sends caption, post date, images and JSON schema; key only in header", async () => {
    const { fn, calls } = fakeFetch(200, ok(extraction));
    const extract = createGeminiExtractor({ apiKey: "secret-key", model: "gemini-3.1-flash-lite", fetch: fn });
    expect(await extract(input)).toEqual(extraction);

    const { url, init } = calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent");
    expect(url).not.toContain("secret-key");
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("secret-key");

    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts[0].text).toContain("Post date: 2026-10-25");
    expect(body.contents[0].parts[0].text).toContain("Hai Semeton");
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "QUJD" } });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.properties).toHaveProperty("jobs");
    expect(body.generationConfig.responseJsonSchema).not.toHaveProperty("$schema");
  });

  test("throws GeminiApiError with status on API errors", async () => {
    const extract = createGeminiExtractor({
      apiKey: "k",
      model: "m",
      fetch: fakeFetch(429, { error: { message: "Resource exhausted" } }).fn,
    });
    const err = await extract(input).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiApiError);
    expect(err).toMatchObject({ status: 429, message: "Resource exhausted" });
  });

  test("rejects output that does not match the schema", async () => {
    const bad = { ...extraction, jobs: [{ title: "Kasir" }] };
    const extract = createGeminiExtractor({ apiKey: "k", model: "m", fetch: fakeFetch(200, ok(bad)).fn });
    expect(extract(input)).rejects.toThrow();
  });

  test("reports missing content with the finish reason", async () => {
    const body = { candidates: [{ finishReason: "SAFETY" }] };
    const extract = createGeminiExtractor({ apiKey: "k", model: "m", fetch: fakeFetch(200, body).fn });
    expect(extract(input)).rejects.toThrow("finishReason: SAFETY");
  });
});

describe("withFallback", () => {
  const fails = (status: number): Extractor => async () => {
    throw new GeminiApiError(status, `status ${status}`);
  };
  const succeeds: Extractor = async () => extraction;

  test("uses the primary model when it works", async () => {
    const { extract, usage } = withFallback(succeeds, fails(500));
    expect(await extract(input)).toEqual(extraction);
    expect(usage).toEqual({ primary: 1, fallback: 0 });
  });

  test("falls back only on 503", async () => {
    const { extract, usage } = withFallback(fails(503), succeeds);
    expect(await extract(input)).toEqual(extraction);
    expect(usage).toEqual({ primary: 0, fallback: 1 });
  });

  test.each([429, 500, 400])("does not fall back on %d", async (status) => {
    let fallbackCalls = 0;
    const { extract } = withFallback(fails(status), async () => {
      fallbackCalls++;
      return extraction;
    });
    expect(extract(input)).rejects.toMatchObject({ status });
    expect(fallbackCalls).toBe(0);
  });

  test("propagates the fallback error when both are overloaded", async () => {
    const { extract } = withFallback(fails(503), fails(503));
    expect(extract(input)).rejects.toMatchObject({ status: 503 });
  });
});
