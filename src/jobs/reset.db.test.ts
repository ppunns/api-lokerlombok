// Integration tests against a local Postgres with migrations applied; see README "Testing".
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { PIPELINE_LOCK_KEY } from "../pipeline/run";
import { jobInsertSchema } from "../schemas/job";
import { connectLocalTestDb, testDatabaseUrl } from "../testing/local-db";
import { upsertJobs } from "./import";
import { countData, PipelineRunningError, resetAll } from "./reset";

describe.skipIf(!testDatabaseUrl)("resetAll (database)", () => {
  let sql: SQL;

  beforeAll(() => {
    sql = connectLocalTestDb();
  });
  beforeEach(async () => {
    await sql`truncate public.jobs, public.source_posts`;
    await sql`
      insert into public.source_posts (source_account, source_post_id, source_post_url, source_posted_at, media_type)
      values ('lokerlombok', '1', 'https://www.instagram.com/p/1/', now(), 'IMAGE'),
             ('lokerlombok', '2', 'https://www.instagram.com/p/2/', now(), 'IMAGE')
    `;
    await upsertJobs(sql, [
      jobInsertSchema.parse({ title: "Kasir", source_account: "lokerlombok", source_post_url: "https://www.instagram.com/p/1/", source_post_id: "1", publication_status: "published" }),
      jobInsertSchema.parse({ title: "Admin", source_account: "lokerlombok", source_post_url: "https://www.instagram.com/p/2/", source_post_id: "2" }),
    ]);
  });
  afterAll(async () => {
    await sql?.close();
  });

  test("countData counts without deleting", async () => {
    expect(await countData(sql)).toEqual({ jobs: 2, source_posts: 2 });
    expect(await countData(sql)).toEqual({ jobs: 2, source_posts: 2 });
  });

  test("deletes every job and source post, whatever its status", async () => {
    expect(await resetAll(sql)).toEqual({ jobs: 2, source_posts: 2 });
    expect(await countData(sql)).toEqual({ jobs: 0, source_posts: 0 });
  });

  test("refuses and deletes nothing while the pipeline holds its lock", async () => {
    const other = connectLocalTestDb();
    try {
      await other`select pg_advisory_lock(${PIPELINE_LOCK_KEY})`;
      await expect(resetAll(sql)).rejects.toBeInstanceOf(PipelineRunningError);
      expect(await countData(sql)).toEqual({ jobs: 2, source_posts: 2 });

      await other`select pg_advisory_unlock(${PIPELINE_LOCK_KEY})`;
      expect(await resetAll(sql)).toEqual({ jobs: 2, source_posts: 2 });
    } finally {
      await other.close();
    }
  });
});
