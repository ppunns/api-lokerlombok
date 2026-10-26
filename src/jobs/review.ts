import type { SQL } from "bun";

export type ReviewStatus = "published" | "rejected" | "draft";

export interface DraftJob {
  id: string;
  title: string;
  company_name: string | null;
  location: string | null;
  deadline: string | null;
  salary_text: string | null;
  source_post_id: string;
  source_post_url: string;
  source_job_index: number;
  source_posted_at: Date | null;
  deadline_passed: boolean;
}

export async function listDrafts(sql: SQL, limit = 50): Promise<DraftJob[]> {
  return sql`
    select id, title, company_name, location, deadline::text as deadline, salary_text,
           source_post_id, source_post_url, source_job_index, source_posted_at,
           coalesce(deadline < (now() at time zone 'Asia/Makassar')::date, false) as deadline_passed
    from public.jobs
    where publication_status = 'draft'
    order by source_posted_at desc nulls last, source_post_id, source_job_index
    limit ${limit}
  `;
}

// Resolves id prefixes (as shown by the review list) to full ids; each must match exactly one job.
export async function resolveJobIds(sql: SQL, prefixes: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const prefix of prefixes) {
    if (!/^[0-9a-f-]{6,36}$/i.test(prefix)) throw new Error(`"${prefix}" is not a job id (min. 6 characters)`);
    const rows = await sql`select id from public.jobs where id::text like ${`${prefix.toLowerCase()}%`} limit 2`;
    if (rows.length === 0) throw new Error(`no job matches "${prefix}"`);
    if (rows.length > 1) throw new Error(`"${prefix}" matches several jobs, use more characters`);
    ids.push(rows[0].id);
  }
  return ids;
}

// Published jobs that went public recently (auto-publish sets them at creation), newest first,
// so an admin can spot wrong or suspicious ones and reject them.
export async function listRecentlyPublished(sql: SQL, days = 3, limit = 100): Promise<DraftJob[]> {
  return sql`
    select id, title, company_name, location, deadline::text as deadline, salary_text,
           source_post_id, source_post_url, source_job_index, source_posted_at,
           false as deadline_passed
    from public.jobs
    where publication_status = 'published' and updated_at >= now() - make_interval(days => ${days})
    order by updated_at desc, source_post_id, source_job_index
    limit ${limit}
  `;
}

export async function getJob(sql: SQL, id: string) {
  // deadline as text so it prints as a plain date; long source text last.
  const [job] = await sql`
    select id, title, company_name, location, description, requirements, employment_type, education_level,
           salary_min::float8 as salary_min, salary_max::float8 as salary_max, salary_text, deadline::text as deadline,
           source_post_url, source_post_id, source_job_index, source_posted_at,
           extraction_status, publication_status, created_at, updated_at, raw_caption, ocr_text
    from public.jobs where id = ${id}
  `;
  return job ?? null;
}

export async function setPublicationStatus(sql: SQL, ids: string[], status: ReviewStatus): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await sql`update public.jobs set publication_status = ${status} where id in ${sql(ids)}`;
  return result.count;
}
