// Integration tests against a local Postgres with migrations applied; see README "Testing".
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { connectLocalTestDb, testDatabaseUrl } from "../testing/local-db";
import { GeminiApiError, type Extraction, type Extractor } from "./gemini";
import { MAX_ATTEMPTS, processPendingPosts } from "./process";

const job = (title: string): Extraction["jobs"][number] => ({
  title,
  company_name: "PT Contoh",
  location: "Mataram",
  regencies: ["kota_mataram"],
  description: null,
  requirements: null,
  employment_type: null,
  education_level: null,
  salary_min: null,
  salary_max: null,
  salary_text: null,
  deadline: null,
});

// Fake extractor keyed by caption.
function fakeExtractor(byCaption: Record<string, Extraction | Error>): Extractor {
  return async ({ caption }) => {
    const result = byCaption[caption ?? ""];
    if (!result) throw new Error(`no fake for ${caption}`);
    if (result instanceof Error) throw result;
    return result;
  };
}

const loadImage = async () => ({ mimeType: "image/jpeg", data: "QUJD" });

describe.skipIf(!testDatabaseUrl)("processPendingPosts (database)", () => {
  let sql: SQL;
  const addPost = (id: string, caption: string, minute = 0) => sql`
    insert into public.source_posts (source_account, source_post_id, source_post_url, source_posted_at, media_type, caption, media_urls)
    values ('lokerlombok', ${id}, ${`https://www.instagram.com/p/${id}/`}, ${new Date(Date.UTC(2026, 9, 25, 0, minute))}, 'IMAGE', ${caption}, ${["https://cdn/x.jpg"]})
  `;
  const status = async (id: string) =>
    (await sql`select processing_status, processing_error, processing_attempts from public.source_posts where source_post_id = ${id}`)[0];

  beforeAll(() => {
    sql = connectLocalTestDb();
  });
  beforeEach(async () => {
    await sql`truncate public.source_posts, public.jobs`;
  });
  afterAll(async () => {
    await sql?.close();
  });

  test("stores extracted jobs as drafts and marks posts processed / no_jobs", async () => {
    await addPost("1", "multi");
    await addPost("2", "iklan");
    const extract = fakeExtractor({
      multi: { is_job_post: true, ocr_text: "HIRING", jobs: [job("Kasir"), job("Gudang")] },
      iklan: { is_job_post: false, ocr_text: "PROMO", jobs: [] },
    });

    const result = await processPendingPosts({ sql, extract, limit: 10, loadImage });
    expect(result).toEqual({ processed: 1, no_jobs: 1, failed: 0, jobs: 2, stopped: null });

    const jobs = await sql`select title, source_post_id, source_job_index, raw_caption, ocr_text, extraction_status, publication_status from public.jobs order by source_job_index`;
    expect(jobs).toEqual([
      { title: "Kasir", source_post_id: "1", source_job_index: 0, raw_caption: "multi", ocr_text: "HIRING", extraction_status: "extracted", publication_status: "draft" },
      { title: "Gudang", source_post_id: "1", source_job_index: 1, raw_caption: "multi", ocr_text: "HIRING", extraction_status: "extracted", publication_status: "draft" },
    ]);
    expect(await status("1")).toEqual({ processing_status: "processed", processing_error: null, processing_attempts: 1 });
    expect(await status("2")).toMatchObject({ processing_status: "no_jobs" });
  });

  test("re-extraction removes leftover drafts but keeps reviewed jobs", async () => {
    await addPost("1", "first");
    const three = { is_job_post: true, ocr_text: null, jobs: [job("A"), job("B"), job("C")] };
    await processPendingPosts({ sql, extract: fakeExtractor({ first: three }), limit: 10, loadImage });
    await sql`update public.jobs set publication_status = 'published' where source_job_index = 2`;

    await sql`update public.source_posts set processing_status = 'pending'`;
    const one = { is_job_post: true, ocr_text: null, jobs: [job("A2")] };
    await processPendingPosts({ sql, extract: fakeExtractor({ first: one }), limit: 10, loadImage });

    const rows = await sql`select title, source_job_index, publication_status from public.jobs order by source_job_index`;
    expect(rows).toEqual([
      { title: "A2", source_job_index: 0, publication_status: "draft" },
      { title: "C", source_job_index: 2, publication_status: "published" },
    ]);
  });

  test("marks invalid extractions and errors as failed, retrying up to MAX_ATTEMPTS", async () => {
    await addPost("1", "kosong");
    await addPost("2", "error");
    const extract = fakeExtractor({
      kosong: { is_job_post: true, ocr_text: null, jobs: [job("  ")] },
      error: new Error("image download failed (403)"),
    });

    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) await processPendingPosts({ sql, extract, limit: 10, loadImage });

    expect(await status("1")).toMatchObject({ processing_status: "failed", processing_attempts: MAX_ATTEMPTS });
    expect((await status("1")).processing_error).toContain("invalid extraction: 0.title");
    expect(await status("2")).toEqual({
      processing_status: "failed",
      processing_error: "image download failed (403)",
      processing_attempts: MAX_ATTEMPTS,
    });
    expect((await sql`select count(*)::int n from public.jobs`)[0].n).toBe(0);
  });

  test("stops on rate limit without spending an attempt, newest posts first", async () => {
    await addPost("old", "ok", 1);
    await addPost("new", "limit", 2);
    const extract = fakeExtractor({
      ok: { is_job_post: true, ocr_text: null, jobs: [job("Kasir")] },
      limit: new GeminiApiError(429, "Resource exhausted"),
    });

    const result = await processPendingPosts({ sql, extract, limit: 10, loadImage });
    expect(result.stopped).toBe("rate_limited");
    expect(result.processed).toBe(0);
    expect(await status("new")).toMatchObject({ processing_status: "pending", processing_attempts: 0 });
    expect(await status("old")).toMatchObject({ processing_status: "pending" });
  });

  test("retries overloaded model, then stops without spending an attempt if still overloaded", async () => {
    await addPost("1", "flaky");
    await addPost("2", "down", 1);
    let flakyCalls = 0;
    const extract: Extractor = async ({ caption }) => {
      if (caption === "down") throw new GeminiApiError(503, "high demand");
      if (++flakyCalls < 3) throw new GeminiApiError(503, "high demand");
      return { is_job_post: true, ocr_text: null, jobs: [job("Kasir")] };
    };

    const first = await processPendingPosts({ sql, extract, limit: 10, loadImage, retryDelaysMs: [0, 0] });
    expect(first.stopped).toBe("unavailable");
    expect(await status("2")).toMatchObject({ processing_status: "pending", processing_attempts: 0 });

    const second = await processPendingPosts({ sql, extract, limit: 1, loadImage, retryDelaysMs: [0, 0] });
    expect(second).toMatchObject({ processed: 0, stopped: "unavailable" });
    // "down" is newest, so it is picked first and keeps blocking; "flaky" succeeds when alone.
    await sql`update public.source_posts set processing_status = 'no_jobs' where source_post_id = '2'`;
    const third = await processPendingPosts({ sql, extract, limit: 10, loadImage, retryDelaysMs: [0, 0] });
    expect(third).toMatchObject({ processed: 1, stopped: null });
    expect(flakyCalls).toBe(3);
  });
});
