// Integration tests against a local Postgres with migrations applied; see README "Testing".
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import type { InstagramClient, InstagramMedia } from "../instagram/client";
import { connectLocalTestDb, testDatabaseUrl } from "../testing/local-db";
import { collectNewPosts } from "./collect";

const media = (id: number): InstagramMedia => ({
  id: String(id),
  caption: `post ${id}`,
  media_type: "IMAGE",
  media_url: `https://cdn.example/${id}.jpg`,
  permalink: `https://www.instagram.com/p/P${id}/`,
  timestamp: new Date(Date.UTC(2026, 9, 25, 0, id)).toISOString().replace(".000Z", "+0000"),
});

// Fake feed: newest first, paged by numeric cursor.
function fakeClient(feed: InstagramMedia[]) {
  const requests: (string | undefined)[] = [];
  const client: InstagramClient = {
    async fetchRecentMedia(_username, { limit, after }) {
      requests.push(after);
      const start = after ? Number(after) : 0;
      const end = start + limit;
      return { media: feed.slice(start, end), after: end < feed.length ? String(end) : undefined };
    },
  };
  return { client, requests };
}

const newestFirst = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => media(to - i));

describe.skipIf(!testDatabaseUrl)("collectNewPosts (database)", () => {
  let sql: SQL;
  const ids = async () =>
    (await sql`select source_post_id from public.source_posts order by source_post_id::int`).map(
      (r: { source_post_id: string }) => Number(r.source_post_id),
    );

  beforeAll(() => {
    sql = connectLocalTestDb();
  });
  beforeEach(async () => {
    await sql`truncate public.source_posts`;
  });
  afterAll(async () => {
    await sql?.close();
  });

  test("first run stores newest posts up to maxPages as pending", async () => {
    const { client, requests } = fakeClient(newestFirst(1, 20));
    const result = await collectNewPosts({ sql, client, username: "lokerlombok", pageSize: 5, maxPages: 2 });

    expect(result).toEqual({ fetched: 10, inserted: 10, pages: 2, reachedKnown: false });
    expect(requests).toEqual([undefined, "5"]);
    expect(await ids()).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const [row] = await sql`select * from public.source_posts where source_post_id = '20'`;
    expect(row).toMatchObject({
      source_account: "lokerlombok",
      processing_status: "pending",
      processing_attempts: 0,
      media_urls: ["https://cdn.example/20.jpg"],
    });
    expect(row.source_posted_at).toEqual(new Date("2026-10-25T00:20:00Z"));
  });

  test("next run only adds new posts and stops at the first known one", async () => {
    await collectNewPosts({ sql, client: fakeClient(newestFirst(1, 10)).client, username: "lokerlombok", pageSize: 5 });
    const { client, requests } = fakeClient(newestFirst(1, 13));
    const result = await collectNewPosts({ sql, client, username: "lokerlombok", pageSize: 5 });

    expect(result).toEqual({ fetched: 5, inserted: 3, pages: 1, reachedKnown: true });
    expect(requests).toEqual([undefined]);
    expect(await ids()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  test("a run with nothing new inserts nothing", async () => {
    const feed = newestFirst(1, 4);
    await collectNewPosts({ sql, client: fakeClient(feed).client, username: "lokerlombok" });
    const result = await collectNewPosts({ sql, client: fakeClient(feed).client, username: "lokerlombok" });
    expect(result).toEqual({ fetched: 4, inserted: 0, pages: 1, reachedKnown: true });
  });
});
