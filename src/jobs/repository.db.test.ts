// Integration tests against a real Postgres with the migration applied.
// Skipped unless TEST_DATABASE_URL is set; see README "Testing".
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { jobInsertSchema, type JobInsert } from "../schemas/job";
import { upsertJobs } from "./import";
import { createJobsRepository } from "./repository";

const url = Bun.env.TEST_DATABASE_URL;

let n = 0;
const make = (overrides: Partial<JobInsert> = {}): JobInsert =>
  jobInsertSchema.parse({
    title: "Staff Admin",
    source_account: "test",
    source_post_url: "https://www.instagram.com/p/T/",
    source_post_id: `P${++n}`,
    publication_status: "published",
    ...overrides,
  });

describe.skipIf(!url)("jobs repository (database)", () => {
  let sql: SQL;
  let repo: ReturnType<typeof createJobsRepository>;
  const search = (q: Record<string, unknown> = {}) => repo.search({ page: 1, limit: 20, ...q });

  beforeAll(() => {
    // These tests truncate public.jobs, so never run them against a remote database.
    const host = new URL(url!).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
      throw new Error("TEST_DATABASE_URL must point to a local database");
    }
    sql = new SQL(url!);
    repo = createJobsRepository(sql);
  });
  beforeEach(async () => {
    await sql`truncate public.jobs`;
  });
  afterAll(async () => {
    await sql?.close();
  });

  test("upsertJobs inserts, then updates by source identity", async () => {
    const first = make({ source_post_id: "X", title: "Kasir" });
    await upsertJobs(sql, [first, make({ source_post_id: "X", source_job_index: 1 })]);
    await upsertJobs(sql, [{ ...first, title: "Kasir Senior" }]);

    const rows = await sql`select title, source_job_index from public.jobs order by source_job_index`;
    expect(rows).toEqual([
      { title: "Kasir Senior", source_job_index: 0 },
      { title: "Staff Admin", source_job_index: 1 },
    ]);
  });

  test("search returns only published jobs", async () => {
    await upsertJobs(sql, [make({ title: "Tampil" }), make({ title: "Draft", publication_status: "draft" })]);
    const { jobs, total } = await search();
    expect(total).toBe(1);
    expect(jobs.map((j) => j.title)).toEqual(["Tampil"]);
  });

  test("q matches title, company or description case-insensitively and literally", async () => {
    await upsertJobs(sql, [
      make({ title: "ADMIN Gudang" }),
      make({ title: "Kasir", company_name: "Admin Center" }),
      make({ title: "Sopir", description: "bantu admin" }),
      make({ title: "Diskon 100%" }),
      make({ title: "Diskon 1000" }),
    ]);
    expect((await search({ q: "admin" })).total).toBe(3);
    expect((await search({ q: "100%" })).jobs.map((j) => j.title)).toEqual(["Diskon 100%"]);
  });

  test("filters by location and enums", async () => {
    await upsertJobs(sql, [
      make({ title: "A", location: "Kota Mataram", employment_type: "full_time", education_level: "s1" }),
      make({ title: "B", location: "Mataram", employment_type: "part_time", education_level: "s1" }),
      make({ title: "C", location: "Praya", employment_type: "full_time", education_level: "d3" }),
    ]);
    const titles = async (q: Record<string, unknown>) => (await search(q)).jobs.map((j) => j.title).sort();
    expect(await titles({ location: "mataram" })).toEqual(["A", "B"]);
    expect(await titles({ employment_type: "full_time" })).toEqual(["A", "C"]);
    expect(await titles({ location: "mataram", education_level: "s1", employment_type: "part_time" })).toEqual(["B"]);
  });

  test("paginates newest first, keeping jobs of one post in order", async () => {
    await upsertJobs(sql, [
      make({ title: "Lama", source_posted_at: "2026-10-01T00:00:00Z" }),
      make({ title: "Baru-2", source_post_id: "NEW", source_job_index: 1, source_posted_at: "2026-10-10T00:00:00Z" }),
      make({ title: "Baru-1", source_post_id: "NEW", source_job_index: 0, source_posted_at: "2026-10-10T00:00:00Z" }),
      make({ title: "Tanpa tanggal" }),
    ]);
    const page1 = await search({ limit: 3 });
    const page2 = await search({ limit: 3, page: 2 });
    expect(page1.total).toBe(4);
    expect(page1.jobs.map((j) => j.title)).toEqual(["Baru-1", "Baru-2", "Lama"]);
    expect(page2.jobs.map((j) => j.title)).toEqual(["Tanpa tanggal"]);
  });

  test("findPublishedById returns public fields with JSON-friendly types", async () => {
    await upsertJobs(sql, [
      make({ source_post_id: "PUB", salary_min: 2_500_000, salary_max: 3_000_000, deadline: "2026-11-30", raw_caption: "x" }),
      make({ source_post_id: "DRAFT", publication_status: "draft" }),
    ]);
    const [pub] = await sql`select id from public.jobs where source_post_id = 'PUB'`;
    const [draft] = await sql`select id from public.jobs where source_post_id = 'DRAFT'`;

    const job = await repo.findPublishedById(pub.id);
    expect(job).toMatchObject({ salary_min: 2_500_000, salary_max: 3_000_000, deadline: "2026-11-30" });
    expect(job).not.toHaveProperty("raw_caption");
    expect(job).not.toHaveProperty("publication_status");
    expect(await repo.findPublishedById(draft.id)).toBeNull();
  });
});
