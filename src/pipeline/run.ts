import type { SQL } from "bun";
import { collectNewPosts } from "../collector/collect";
import type { Extractor } from "../extraction/gemini";
import { processPendingPosts } from "../extraction/process";
import { expireJobs } from "../jobs/expire";
import { InstagramApiError, type InstagramClient } from "../instagram/client";

export interface PipelineOptions {
  sql: SQL;
  client: InstagramClient;
  username: string;
  extract: Extractor;
  extractLimit: number;
  autoPublish?: boolean;
}

export function describeError(err: unknown): string {
  if (err instanceof InstagramApiError) {
    const hint = err.code === 190 ? " (token expired or invalid: renew IG_ACCESS_TOKEN)" : "";
    return `Instagram ${err.status}/${err.code}: ${err.message}${hint}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// Arbitrary constant key for the Postgres advisory lock that allows only one pipeline run at a time.
export const PIPELINE_LOCK_KEY = 4_120_261_027;

// One polling round: collect new posts, extract jobs from pending ones, then expire closed jobs.
// A failed collect does not block extracting posts that are already stored.
// If another round is still running (schedulers can start overlapping runs), this one does nothing.
export async function runPipelineOnce(options: PipelineOptions) {
  const { sql } = options;
  // Session-level lock on a reserved connection; it is released on unlock or when the process dies.
  const lockConn = await sql.reserve();
  try {
    const [{ locked }] = await lockConn`select pg_try_advisory_lock(${PIPELINE_LOCK_KEY}) as locked`;
    if (!locked) return { skipped: true as const };
    try {
      return { skipped: false as const, ...(await runRound(options)) };
    } finally {
      await lockConn`select pg_advisory_unlock(${PIPELINE_LOCK_KEY})`;
    }
  } finally {
    lockConn.release();
  }
}

async function runRound({ sql, client, username, extract, extractLimit, autoPublish }: PipelineOptions) {
  const result = {
    collect: null as Awaited<ReturnType<typeof collectNewPosts>> | null,
    collectError: null as string | null,
    extract: null as Awaited<ReturnType<typeof processPendingPosts>> | null,
    extractError: null as string | null,
    expired: null as number | null,
    expireError: null as string | null,
  };

  try {
    result.collect = await collectNewPosts({ sql, client, username });
  } catch (err) {
    result.collectError = describeError(err);
  }
  try {
    result.extract = await processPendingPosts({ sql, extract, limit: extractLimit, autoPublish });
  } catch (err) {
    result.extractError = describeError(err);
  }
  try {
    result.expired = await expireJobs(sql);
  } catch (err) {
    result.expireError = describeError(err);
  }
  return result;
}
