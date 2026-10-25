import type { SQL } from "bun";
import { upsertJobs, validateJobs } from "../jobs/import";
import type { JobInsert } from "../schemas/job";
import { GeminiApiError, type Extraction, type Extractor } from "./gemini";

export const MAX_ATTEMPTS = 3;
const MAX_IMAGES = 5;
// Gemini overload errors: retried with these delays, then the run stops.
const TRANSIENT_STATUSES = [500, 503];
const RETRY_DELAYS_MS = [2_000, 8_000];

export interface SourcePost {
  id: string;
  source_account: string;
  source_post_id: string;
  source_post_url: string;
  source_posted_at: Date;
  caption: string | null;
  media_urls: string[];
}

// Downloads an image into memory for the model; it is never written to disk or the database.
export async function fetchImage(url: string, doFetch: typeof fetch = fetch) {
  const res = await doFetch(url);
  if (!res.ok) throw new Error(`image download failed (${res.status})`);
  return {
    mimeType: res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg",
    data: Buffer.from(await res.arrayBuffer()).toString("base64"),
  };
}

export function toJobInserts(post: SourcePost, extraction: Extraction): JobInsert[] {
  return extraction.jobs.map((job, index) => ({
    ...job,
    source_platform: "instagram",
    source_account: post.source_account,
    source_post_url: post.source_post_url,
    source_post_id: post.source_post_id,
    source_job_index: index,
    source_posted_at: post.source_posted_at.toISOString(),
    raw_caption: post.caption,
    ocr_text: extraction.ocr_text,
    extraction_status: "extracted",
    // Drafts until reviewed; AI output is not treated as verified.
    publication_status: "draft",
  }));
}

export interface ProcessOptions {
  sql: SQL;
  extract: Extractor;
  limit: number;
  loadImage?: (url: string) => Promise<{ mimeType: string; data: string }>;
  retryDelaysMs?: number[];
}

type Outcome = "processed" | "no_jobs" | "failed";

async function extractWithRetry(extract: Extractor, input: Parameters<Extractor>[0], delays: number[]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await extract(input);
    } catch (err) {
      const transient = err instanceof GeminiApiError && TRANSIENT_STATUSES.includes(err.status);
      if (!transient || attempt >= delays.length) throw err;
      await Bun.sleep(delays[attempt]!);
    }
  }
}

export async function processPendingPosts({
  sql,
  extract,
  limit,
  loadImage = (u) => fetchImage(u),
  retryDelaysMs = RETRY_DELAYS_MS,
}: ProcessOptions) {
  const posts: SourcePost[] = await sql`
    select id, source_account, source_post_id, source_post_url, source_posted_at, caption, media_urls
    from public.source_posts
    where processing_status = 'pending' or (processing_status = 'failed' and processing_attempts < ${MAX_ATTEMPTS})
    order by source_posted_at desc
    limit ${limit}
  `;

  const counts = {
    processed: 0,
    no_jobs: 0,
    failed: 0,
    jobs: 0,
    stopped: null as null | "rate_limited" | "unavailable",
  };
  for (const post of posts) {
    let outcome: Outcome;
    let error: string | null = null;
    let jobs: JobInsert[] = [];
    try {
      const images = await Promise.all(post.media_urls.slice(0, MAX_IMAGES).map(loadImage));
      const input = { caption: post.caption, postedAt: post.source_posted_at, images };
      const extraction = await extractWithRetry(extract, input, retryDelaysMs);
      const validated = validateJobs(toJobInserts(post, extraction));
      if (extraction.jobs.length === 0) outcome = "no_jobs";
      else if (validated.ok) {
        outcome = "processed";
        jobs = validated.jobs;
      } else {
        outcome = "failed";
        error = `invalid extraction: ${validated.errors.join("; ")}`;
      }
    } catch (err) {
      // Quota and overload errors are not the post's fault: stop the run without spending an attempt.
      if (err instanceof GeminiApiError && (err.status === 429 || TRANSIENT_STATUSES.includes(err.status))) {
        counts.stopped = err.status === 429 ? "rate_limited" : "unavailable";
        break;
      }
      outcome = "failed";
      error = err instanceof Error ? err.message : String(err);
    }

    const extractedCount = jobs.length;
    await sql.begin(async (tx) => {
      // Never overwrite jobs that were already published or rejected by a reviewer.
      const reviewed = await tx`
        select source_job_index from public.jobs
        where source_platform = 'instagram' and source_post_id = ${post.source_post_id}
          and publication_status <> 'draft'
      `;
      const reviewedIndexes = new Set(reviewed.map((r: { source_job_index: number }) => r.source_job_index));
      jobs = jobs.filter((job) => !reviewedIndexes.has(job.source_job_index));
      if (jobs.length) await upsertJobs(tx, jobs);
      // On re-extraction, drop leftover drafts beyond the new job count; reviewed jobs are kept.
      if (outcome !== "failed") {
        await tx`
          delete from public.jobs
          where source_platform = 'instagram' and source_post_id = ${post.source_post_id}
            and source_job_index >= ${extractedCount} and publication_status = 'draft'
        `;
      }
      await tx`
        update public.source_posts
        set processing_status = ${outcome}, processing_error = ${error?.slice(0, 1000) ?? null},
            processing_attempts = processing_attempts + 1
        where id = ${post.id}
      `;
    });
    counts[outcome]++;
    counts.jobs += jobs.length;
  }
  return counts;
}
