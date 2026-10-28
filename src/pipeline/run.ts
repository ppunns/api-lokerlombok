import type { SQL } from "bun";
import { collectNewPosts, collectPostsSince } from "../collector/collect";
import type { Extractor } from "../extraction/gemini";
import { processPendingPosts } from "../extraction/process";
import { expireJobs } from "../jobs/expire";
import { InstagramApiError, type InstagramClient } from "../instagram/client";
import { collectSinceFor, formatWita, isCollectDue, loadSchedule, markCollected, nextSlot } from "./schedule";

export interface PipelineOptions {
  sql: SQL;
  client: InstagramClient;
  username: string;
  extract: Extractor;
  extractLimit: number;
  autoPublish?: boolean;
  // Manual backfill: collect every post since this date instead of stopping at the first known post.
  collectSince?: Date;
  // Follow pipeline_schedule when it has a row: its account, publish choice, and times decide whether
  // this round collects. Without a row, every round collects with the options above.
  useSchedule?: boolean;
  now?: Date;
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

async function runRound(options: PipelineOptions) {
  const { sql, client, extract, extractLimit, now = new Date() } = options;
  let { username, autoPublish, collectSince } = options;
  const result = {
    collect: null as Awaited<ReturnType<typeof collectNewPosts | typeof collectPostsSince>> | null,
    // Why this round did not collect, e.g. the next scheduled time has not come yet.
    collectSkipped: null as string | null,
    collectError: null as string | null,
    extract: null as Awaited<ReturnType<typeof processPendingPosts>> | null,
    extractError: null as string | null,
    expired: null as number | null,
    expireError: null as string | null,
  };

  try {
    const schedule = options.useSchedule ? await loadSchedule(sql) : null;
    if (schedule) {
      username = schedule.account;
      autoPublish = schedule.auto_publish;
      if (!schedule.enabled) result.collectSkipped = "schedule is off";
      else if (!isCollectDue(schedule, now)) result.collectSkipped = `not due, next at ${formatWita(nextSlot(schedule.run_times, now))}`;
      else collectSince = collectSinceFor(schedule, now);
    }
    if (!result.collectSkipped) {
      result.collect = collectSince
        ? await collectPostsSince({ sql, client, username, since: collectSince })
        : await collectNewPosts({ sql, client, username });
      if (schedule) await markCollected(sql, now);
    }
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
