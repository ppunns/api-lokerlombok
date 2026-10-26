// Integration tests against a local Postgres with migrations applied; see README "Testing".
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { connectLocalTestDb, testDatabaseUrl } from "../testing/local-db";
import { jobInsertSchema } from "../schemas/job";
import { upsertJobs } from "./import";
import { checkReadOnlyAccess } from "./readonly-check";
import { createJobsRepository } from "./repository";

test("a write check only passes on a permission error, not on any error", async () => {
  const fail = async () => {
    throw new Error('syntax error at or near "selec"');
  };
  const broken = Object.assign(fail, { begin: fail }) as unknown as SQL;
  const checks = await checkReadOnlyAccess(broken);
  expect(checks.every((c) => !c.ok)).toBe(true);
});

describe.skipIf(!testDatabaseUrl)("api_readonly role (database)", () => {
  let admin: SQL;
  let api: SQL;

  beforeAll(async () => {
    admin = connectLocalTestDb();
    api = connectLocalTestDb("api_readonly");
    await admin`truncate public.source_posts, public.jobs`;
    const job = (id: string, publication_status: "published" | "draft") =>
      jobInsertSchema.parse({
        title: `Job ${id}`,
        source_account: "test",
        source_post_url: "https://www.instagram.com/p/T/",
        source_post_id: id,
        publication_status,
      });
    await upsertJobs(admin, [job("pub", "published"), job("draft", "draft")]);
  });
  afterAll(async () => {
    await api?.close();
    await admin?.close();
  });

  test("passes every read-only check", async () => {
    const checks = await checkReadOnlyAccess(api);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks).toHaveLength(7);
  });


  test("the API repository works and only returns published jobs", async () => {
    const repo = createJobsRepository(api);
    const { jobs, total } = await repo.search({ page: 1, limit: 20 });
    expect(total).toBe(1);
    expect(jobs.map((j) => j.source_post_id)).toEqual(["pub"]);
    expect(await api`select 1 as ok`).toEqual([{ ok: 1 }]);
  });

  test("flags a privileged connection and leaves its data unchanged", async () => {
    const checks = await checkReadOnlyAccess(admin);
    expect(checks.find((c) => c.name === "cannot delete jobs, even read-write")?.ok).toBe(false);
    expect(checks.find((c) => c.name.startsWith("connected as"))?.ok).toBe(false);
    expect((await admin`select count(*)::int as n from public.jobs`)[0].n).toBe(2);
  });
});
