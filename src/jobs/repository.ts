import type { SQL } from "bun";
import type { JobSearchQuery, PublicJob } from "../schemas/job";

export interface JobsRepository {
  search(query: JobSearchQuery): Promise<{ jobs: PublicJob[]; total: number }>;
  findPublishedById(id: string): Promise<PublicJob | null>;
}

// Escapes LIKE wildcards so user input is matched literally.
export function toLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export function createJobsRepository(sql: SQL): JobsRepository {
  // Casts keep JSON output stable: bigint -> number, date -> "YYYY-MM-DD".
  const columns = sql`
    id, title, company_name, location, regencies, description, requirements,
    employment_type, education_level,
    salary_min::float8 as salary_min, salary_max::float8 as salary_max, salary_text,
    deadline::text as deadline,
    source_platform, source_account, source_post_url, source_post_id, source_job_index,
    source_posted_at, created_at, updated_at
  `;

  return {
    async search(query) {
      const filters = [sql`publication_status = 'published'`];
      if (query.q) {
        const pattern = toLikePattern(query.q);
        filters.push(sql`and (title ilike ${pattern} or company_name ilike ${pattern} or description ilike ${pattern})`);
      }
      if (query.location) filters.push(sql`and location ilike ${toLikePattern(query.location)}`);
      if (query.regency) filters.push(sql`and ${query.regency} = any(regencies)`);
      if (query.employment_type) filters.push(sql`and employment_type = ${query.employment_type}`);
      if (query.education_level) filters.push(sql`and education_level = ${query.education_level}`);

      const offset = (query.page - 1) * query.limit;
      const [jobs, [count]] = await Promise.all([
        sql`
          select ${columns} from public.jobs where ${filters}
          order by source_posted_at desc nulls last, created_at desc, source_post_id, source_job_index, id
          limit ${query.limit} offset ${offset}
        `,
        sql`select count(*)::int as total from public.jobs where ${filters}`,
      ]);
      return { jobs, total: count.total };
    },

    async findPublishedById(id) {
      const [job] = await sql`
        select ${columns} from public.jobs
        where id = ${id} and publication_status = 'published'
      `;
      return job ?? null;
    },
  };
}
