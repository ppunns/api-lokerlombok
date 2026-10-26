// Integration tests against a local Postgres with migrations applied; see README "Testing".
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { jobInsertSchema, type JobInsert } from "../schemas/job";
import { connectLocalTestDb, testDatabaseUrl } from "../testing/local-db";
import { expireJobs, NO_DEADLINE_MAX_AGE_DAYS } from "./expire";
import { upsertJobs } from "./import";

const shiftDate = (isoDate: string, days: number) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe.skipIf(!testDatabaseUrl)("expireJobs (database)", () => {
  let sql: SQL;
  let todayWita: string;
  const make = (title: string, o: Partial<JobInsert>) =>
    jobInsertSchema.parse({
      title,
      source_account: "lokerlombok",
      source_post_url: "https://www.instagram.com/p/X/",
      source_post_id: title,
      source_posted_at: daysAgo(1),
      publication_status: "published",
      ...o,
    });
  const statuses = async () =>
    Object.fromEntries(
      (await sql`select title, publication_status from public.jobs`).map((r: { title: string; publication_status: string }) => [
        r.title,
        r.publication_status,
      ]),
    );

  beforeAll(async () => {
    sql = connectLocalTestDb();
    // "Today" as Lombok sees it, independent of the server and test machine time zones.
    todayWita = (await sql`select (now() at time zone 'Asia/Makassar')::date::text as d`)[0].d;
  });
  beforeEach(async () => {
    await sql`truncate public.jobs`;
  });
  afterAll(async () => {
    await sql?.close();
  });

  test("expires passed deadlines (WITA) and old jobs without a deadline, nothing else", async () => {
    await upsertJobs(sql, [
      make("deadline kemarin", { deadline: shiftDate(todayWita, -1) }),
      make("deadline hari ini", { deadline: todayWita }),
      make("deadline besok", { deadline: shiftDate(todayWita, 1) }),
      make("tanpa deadline, lama", { source_posted_at: daysAgo(NO_DEADLINE_MAX_AGE_DAYS + 1) }),
      make("tanpa deadline, baru", { source_posted_at: daysAgo(NO_DEADLINE_MAX_AGE_DAYS - 1) }),
      // Old post but the stated deadline is still ahead: the deadline wins.
      make("post lama, deadline besok", { source_posted_at: daysAgo(60), deadline: shiftDate(todayWita, 1) }),
      make("draft lewat", { deadline: shiftDate(todayWita, -1), publication_status: "draft" }),
      make("ditolak lewat", { deadline: shiftDate(todayWita, -1), publication_status: "rejected" }),
    ]);

    expect(await expireJobs(sql)).toBe(2);
    expect(await statuses()).toEqual({
      "deadline kemarin": "expired",
      "deadline hari ini": "published",
      "deadline besok": "published",
      "tanpa deadline, lama": "expired",
      "tanpa deadline, baru": "published",
      "post lama, deadline besok": "published",
      "draft lewat": "draft",
      "ditolak lewat": "rejected",
    });
    // Idempotent.
    expect(await expireJobs(sql)).toBe(0);
  });

  test("falls back to created_at when the post date is unknown", async () => {
    await upsertJobs(sql, [make("tanpa tanggal", { source_posted_at: null })]);
    expect(await expireJobs(sql)).toBe(0);
    await sql`update public.jobs set created_at = now() - make_interval(days => ${NO_DEADLINE_MAX_AGE_DAYS + 1})`;
    expect(await expireJobs(sql)).toBe(1);
  });

  test("can be limited to one source post", async () => {
    await upsertJobs(sql, [
      make("A", { deadline: shiftDate(todayWita, -1) }),
      make("B", { deadline: shiftDate(todayWita, -1) }),
    ]);
    expect(await expireJobs(sql, "A")).toBe(1);
    expect(await statuses()).toEqual({ A: "expired", B: "published" });
  });
});
