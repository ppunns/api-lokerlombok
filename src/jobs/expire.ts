import type { SQL } from "bun";

// Jobs without a deadline are treated as closed this long after the source post.
export const NO_DEADLINE_MAX_AGE_DAYS = 30;

// Moves published jobs that are closed to "expired", so they leave the public API:
// - the deadline is before today in Lombok time (WITA, Asia/Makassar); the deadline day itself is still open;
// - there is no deadline and the post is older than NO_DEADLINE_MAX_AGE_DAYS.
// Drafts and rejected jobs are left alone. `sourcePostId` limits it to one post (used right after extraction).
export async function expireJobs(sql: SQL, sourcePostId?: string): Promise<number> {
  const result = await sql`
    update public.jobs set publication_status = 'expired'
    where publication_status = 'published'
      ${sourcePostId ? sql`and source_platform = 'instagram' and source_post_id = ${sourcePostId}` : sql``}
      and (
        deadline < (now() at time zone 'Asia/Makassar')::date
        or (deadline is null
            and coalesce(source_posted_at, created_at) < now() - make_interval(days => ${NO_DEADLINE_MAX_AGE_DAYS}))
      )
  `;
  return result.count;
}
