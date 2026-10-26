import { z } from "zod";
import { educationLevels, employmentTypes, regencies } from "../schemas/job";

// What the model returns for one post. Everything not explicitly stated must be null.
export const extractionSchema = z.object({
  is_job_post: z.boolean(),
  ocr_text: z.string().nullable(),
  jobs: z.array(
    z.object({
      title: z.string(),
      company_name: z.string().nullable(),
      location: z.string().nullable(),
      regencies: z.array(z.enum(regencies)),
      description: z.string().nullable(),
      requirements: z.array(z.string()).nullable(),
      employment_type: z.enum(employmentTypes).nullable(),
      education_level: z.enum(educationLevels).nullable(),
      salary_min: z.number().int().nullable(),
      salary_max: z.number().int().nullable(),
      salary_text: z.string().nullable(),
      deadline: z.string().nullable(),
    }),
  ),
});

export type Extraction = z.infer<typeof extractionSchema>;

const { $schema: _, ...responseJsonSchema } = z.toJSONSchema(extractionSchema) as Record<string, unknown>;

const INSTRUCTIONS = `You extract job vacancies from one Instagram post of @lokerlombok, a job board for Lombok, NTB, Indonesia.
You get the caption, the post date, and the poster image(s). Rules:
- Transcribe all readable text from the images into ocr_text (null if there is none).
- is_job_post is false for anything that is not a job vacancy (ads, promotions, greetings only); then jobs is [].
- Create one job per distinct position, in the order they appear. Several positions on one poster are separate jobs.
- Use only information explicitly present in the caption or images. Use null when something is not stated.
  Never guess or invent a company, location, salary, requirements, or deadline.
- Keep Indonesian wording as written. title is the position name.
- location: the work location as written. regencies: the NTB kabupaten/kota of that stated location
  (town, kecamatan, address, or names like Loteng = Lombok Tengah, Lotim = Lombok Timur, Lobar = Lombok Barat,
  KLU = Lombok Utara). Kota Mataram (incl. Cakranegara, Ampenan, Sekarbela, Selaparang, Sandubaya) is not Lombok Barat.
  List several if the job covers several regencies; [] if no location is stated or it is outside NTB.
- description: short summary of duties if stated, followed by how to apply (email, WhatsApp, address) if stated.
- requirements: the listed requirement items, or null.
- employment_type only if explicit: tetap/full time -> full_time, part time -> part_time, kontrak -> contract,
  magang/internship -> internship, freelance -> freelance.
- education_level: the minimum education if explicit: SD -> sd, SMP -> smp, SMA/SMK -> sma_smk, D1-D4 -> d1-d4, S1-S3 -> s1-s3.
- salary_min/salary_max: integers in rupiah only for explicit amounts (e.g. "Rp2,5 juta" -> 2500000).
  Vague salary ("UMK", "menarik", "kompetitif") -> numbers null, original text in salary_text.
- deadline: YYYY-MM-DD only if a closing date is stated. If the year is missing, use the post year,
  or the next year if that date would be before the post date.`;

export interface ExtractionInput {
  caption: string | null;
  postedAt: Date;
  images: { mimeType: string; data: string }[]; // base64
}

export class GeminiApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface GeminiClientOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

// Status for a request this client gave up on. It is not an overload status, so it is neither
// retried nor sent to the fallback model; the post spends one attempt (see extraction/process.ts).
export const GEMINI_TIMEOUT_STATUS = 408;

export function createGeminiExtractor({ apiKey, model, fetch: doFetch = fetch, timeoutMs = 60_000 }: GeminiClientOptions) {
  return async function extract(input: ExtractionInput): Promise<Extraction> {
    const text = `Post date: ${input.postedAt.toISOString().slice(0, 10)}\nCaption:\n${input.caption ?? "(no caption)"}`;
    const signal = AbortSignal.timeout(timeoutMs);
    const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      signal,
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
        contents: [
          {
            role: "user",
            parts: [{ text }, ...input.images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } }))],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema },
      }),
    }).catch((err) => {
      throw signal.aborted ? new GeminiApiError(GEMINI_TIMEOUT_STATUS, `Gemini request timed out after ${timeoutMs}ms`) : err;
    });

    // Gateways can answer with HTML (e.g. 502); keep the real status instead of a JSON parse error.
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) throw new GeminiApiError(res.status, body?.error?.message ?? `Gemini API error (HTTP ${res.status})`);
    if (body === null) {
      const reason = signal.aborted ? `timed out after ${timeoutMs}ms` : "invalid JSON";
      throw new GeminiApiError(signal.aborted ? GEMINI_TIMEOUT_STATUS : res.status, `Gemini response ${reason}`);
    }

    const output = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof output !== "string") {
      throw new GeminiApiError(res.status, `No content (finishReason: ${body?.candidates?.[0]?.finishReason ?? "none"})`);
    }
    return extractionSchema.parse(JSON.parse(output));
  };
}

export type Extractor = ReturnType<typeof createGeminiExtractor>;

// Uses the fallback model only when the primary model is overloaded (503).
// Quota (429) and other errors are passed through unchanged.
export function withFallback(primary: Extractor, fallback: Extractor) {
  const usage = { primary: 0, fallback: 0 };
  const extract: Extractor = async (input) => {
    try {
      const result = await primary(input);
      usage.primary++;
      return result;
    } catch (err) {
      if (!(err instanceof GeminiApiError && err.status === 503)) throw err;
      const result = await fallback(input);
      usage.fallback++;
      return result;
    }
  };
  return { extract, usage };
}
