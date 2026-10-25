// Integration tests against a local Postgres with migrations applied; see README "Testing".
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { jobInsertSchema } from "../schemas/job";
import { connectLocalTestDb, testDatabaseUrl } from "../testing/local-db";
import { upsertJobs } from "./import";
import { createJobsRepository } from "./repository";
import { listDrafts, resolveJobIds, setPublicationStatus } from "./review";

describe.skipIf(!testDatabaseUrl)("job review (database)", () => {
  let sql: SQL;
  const idOf = async (postId: string, index = 0) =>
    (await sql`select id from public.jobs where source_post_id = ${postId} and source_job_index = ${index}`)[0].id as string;

  beforeAll(() => {
    sql = connectLocalTestDb();
  });
  beforeEach(async () => {
    await sql`truncate public.jobs`;
    const make = (o: Record<string, unknown>) =>
      jobInsertSchema.parse({ source_account: "lokerlombok", source_post_url: "https://www.instagram.com/p/X/", ...o });
    await upsertJobs(sql, [
      make({ title: "Kasir", source_post_id: "A", source_job_index: 0, source_posted_at: "2026-10-25T00:00:00Z", deadline: "2020-01-01" }),
      make({ title: "Gudang", source_post_id: "A", source_job_index: 1, source_posted_at: "2026-10-25T00:00:00Z" }),
      make({ title: "Lama", source_post_id: "B", source_posted_at: "2026-10-20T00:00:00Z" }),
      make({ title: "Sudah tayang", source_post_id: "C", publication_status: "published" }),
    ]);
  });
  afterAll(async () => {
    await sql?.close();
  });

  test("lists only drafts, newest post first, flagging passed deadlines", async () => {
    const drafts = await listDrafts(sql);
    expect(drafts.map((d) => [d.title, d.deadline_passed])).toEqual([
      ["Kasir", true],
      ["Gudang", false],
      ["Lama", false],
    ]);
  });

  test("resolves unique id prefixes and rejects unknown, ambiguous or invalid ones", async () => {
    const id = await idOf("A");
    expect(await resolveJobIds(sql, [id.slice(0, 8)])).toEqual([id]);
    expect(resolveJobIds(sql, ["ffffffff"])).rejects.toThrow("no job matches");
    expect(resolveJobIds(sql, ["abc"])).rejects.toThrow("is not a job id");
    expect(resolveJobIds(sql, ["x'; drop"])).rejects.toThrow("is not a job id");
  });

  test("publish makes jobs visible in the public API, reject hides them again", async () => {
    const repo = createJobsRepository(sql);
    const ids = [await idOf("A", 0), await idOf("A", 1)];

    expect(await setPublicationStatus(sql, ids, "published")).toBe(2);
    expect((await repo.search({ page: 1, limit: 20 })).total).toBe(3);
    expect((await listDrafts(sql)).map((d) => d.title)).toEqual(["Lama"]);

    expect(await setPublicationStatus(sql, [ids[0]!], "rejected")).toBe(1);
    expect(await repo.findPublishedById(ids[0]!)).toBeNull();
    expect((await repo.search({ page: 1, limit: 20 })).total).toBe(2);
  });
});
