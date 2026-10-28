import type { SQL } from "bun";
import { PIPELINE_LOCK_KEY } from "../pipeline/run";

export interface DataCounts {
  jobs: number;
  source_posts: number;
}

export class PipelineRunningError extends Error {
  constructor() {
    super("the pipeline is running right now; try again when the round has finished");
  }
}

export async function countData(sql: SQL): Promise<DataCounts> {
  const [row] = await sql`
    select (select count(*)::int from public.jobs) as jobs,
           (select count(*)::int from public.source_posts) as source_posts
  `;
  return row;
}

// Deletes all jobs and all collected posts in one transaction, to start over from an empty database.
// The next collect then treats every recent post as new again (up to its page cap) and re-extracts it.
// Refuses while a pipeline round holds the pipeline lock, so a round cannot write into a half-reset database.
export async function resetAll(sql: SQL): Promise<DataCounts> {
  return sql.begin(async (tx) => {
    const [{ locked }] = await tx`select pg_try_advisory_xact_lock(${PIPELINE_LOCK_KEY}) as locked`;
    if (!locked) throw new PipelineRunningError();
    const jobs = await tx`delete from public.jobs`;
    const posts = await tx`delete from public.source_posts`;
    return { jobs: jobs.count, source_posts: posts.count };
  });
}
