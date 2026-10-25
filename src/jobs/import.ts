import type { SQL } from "bun";
import { z } from "zod";
import { jobInsertColumns, jobInsertSchema, type JobInsert } from "../schemas/job";

// Account name used by data/sample-jobs.json so sample rows can be removed later.
export const SAMPLE_SOURCE_ACCOUNT = "contoh_data";

const sourceKey = (job: JobInsert) => `${job.source_platform}:${job.source_post_id}#${job.source_job_index}`;

export function validateJobs(input: unknown): { ok: true; jobs: JobInsert[] } | { ok: false; errors: string[] } {
  const parsed = z.array(jobInsertSchema).min(1).safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return { ok: false, errors };
  }

  const seen = new Map<string, number>();
  const errors: string[] = [];
  parsed.data.forEach((job, i) => {
    const key = sourceKey(job);
    const first = seen.get(key);
    if (first !== undefined) errors.push(`${i}: duplicate source (${key}) of item ${first}`);
    else seen.set(key, i);
  });
  return errors.length ? { ok: false, errors } : { ok: true, jobs: parsed.data };
}

// Inserts or updates jobs by source identity in a single statement (all or nothing).
export async function upsertJobs(sql: SQL, jobs: JobInsert[]): Promise<number> {
  const updates = jobInsertColumns
    .filter((col) => !["source_platform", "source_post_id", "source_job_index"].includes(col))
    .map((col) => `${col} = excluded.${col}`)
    .join(", ");

  const result = await sql`
    insert into public.jobs ${sql(jobs, ...jobInsertColumns)}
    on conflict (source_platform, source_post_id, source_job_index)
    do update set ${sql.unsafe(updates)}
  `;
  return result.count;
}
