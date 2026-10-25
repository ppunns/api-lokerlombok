import type { SQL } from "bun";
import { collectNewPosts } from "../collector/collect";
import type { Extractor } from "../extraction/gemini";
import { processPendingPosts } from "../extraction/process";
import { InstagramApiError, type InstagramClient } from "../instagram/client";

export interface PipelineOptions {
  sql: SQL;
  client: InstagramClient;
  username: string;
  extract: Extractor;
  extractLimit: number;
}

export function describeError(err: unknown): string {
  if (err instanceof InstagramApiError) {
    const hint = err.code === 190 ? " (token expired or invalid: renew IG_ACCESS_TOKEN)" : "";
    return `Instagram ${err.status}/${err.code}: ${err.message}${hint}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// One polling round: collect new posts, then extract jobs from pending ones.
// A failed collect does not block extracting posts that are already stored.
export async function runPipelineOnce({ sql, client, username, extract, extractLimit }: PipelineOptions) {
  const result = {
    collect: null as Awaited<ReturnType<typeof collectNewPosts>> | null,
    collectError: null as string | null,
    extract: null as Awaited<ReturnType<typeof processPendingPosts>> | null,
    extractError: null as string | null,
  };

  try {
    result.collect = await collectNewPosts({ sql, client, username });
  } catch (err) {
    result.collectError = describeError(err);
  }
  try {
    result.extract = await processPendingPosts({ sql, extract, limit: extractLimit });
  } catch (err) {
    result.extractError = describeError(err);
  }
  return result;
}
