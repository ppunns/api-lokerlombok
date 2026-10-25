// Integration tests against a local Postgres with migrations applied; see README "Testing".
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import type { Extractor } from "../extraction/gemini";
import { InstagramApiError, type InstagramClient, type InstagramMedia } from "../instagram/client";
import { connectLocalTestDb, testDatabaseUrl } from "../testing/local-db";
import { describeError, runPipelineOnce } from "./run";

// No media_url, so extraction has no images to download in tests.
const media = (id: number): InstagramMedia => ({
  id: String(id),
  caption: `post ${id}`,
  media_type: "IMAGE",
  permalink: `https://www.instagram.com/p/P${id}/`,
  timestamp: new Date(Date.UTC(2026, 9, 25, 0, id)).toISOString(),
});

const feedClient = (feed: InstagramMedia[]): InstagramClient => ({
  fetchRecentMedia: async () => ({ media: feed, after: undefined }),
});
const failingClient: InstagramClient = {
  fetchRecentMedia: async () => {
    throw new InstagramApiError(401, 190, "Error validating access token: Session has expired");
  },
};

const extract: Extractor = async ({ caption }) => ({
  is_job_post: true,
  ocr_text: null,
  jobs: [
    {
      title: `Kasir ${caption}`,
      company_name: null,
      location: null,
      regencies: [],
      description: null,
      requirements: null,
      employment_type: null,
      education_level: null,
      salary_min: null,
      salary_max: null,
      salary_text: null,
      deadline: null,
    },
  ],
});

describe.skipIf(!testDatabaseUrl)("runPipelineOnce (database)", () => {
  let sql: SQL;
  const opts = (client: InstagramClient) => ({ sql, client, username: "lokerlombok", extract, extractLimit: 10 });

  beforeAll(() => {
    sql = connectLocalTestDb();
  });
  beforeEach(async () => {
    await sql`truncate public.source_posts, public.jobs`;
  });
  afterAll(async () => {
    await sql?.close();
  });

  test("collects new posts and extracts them as draft jobs in one round", async () => {
    const r = await runPipelineOnce(opts(feedClient([media(2), media(1)])));
    expect(r.collectError).toBeNull();
    expect(r.collect).toMatchObject({ inserted: 2 });
    expect(r.extract).toMatchObject({ processed: 2, jobs: 2, stopped: null });
    const jobs = await sql`select publication_status from public.jobs`;
    expect(jobs.map((j: { publication_status: string }) => j.publication_status)).toEqual(["draft", "draft"]);
  });

  test("a second round with nothing new does not reprocess or duplicate", async () => {
    await runPipelineOnce(opts(feedClient([media(1)])));
    const r = await runPipelineOnce(opts(feedClient([media(1)])));
    expect(r.collect).toMatchObject({ inserted: 0 });
    expect(r.extract).toMatchObject({ processed: 0, jobs: 0 });
    expect((await sql`select count(*)::int n from public.jobs`)[0].n).toBe(1);
  });

  test("still extracts stored pending posts when collect fails", async () => {
    await runPipelineOnce({ ...opts(feedClient([media(1)])), extractLimit: 1 });
    await sql`update public.source_posts set processing_status = 'pending'`;
    await sql`truncate public.jobs`;

    const r = await runPipelineOnce(opts(failingClient));
    expect(r.collect).toBeNull();
    expect(r.collectError).toContain("token expired or invalid");
    expect(r.extract).toMatchObject({ processed: 1 });
  });
});

describe("describeError", () => {
  test("adds a renewal hint for expired Instagram tokens only", () => {
    expect(describeError(new InstagramApiError(401, 190, "expired"))).toBe(
      "Instagram 401/190: expired (token expired or invalid: renew IG_ACCESS_TOKEN)",
    );
    expect(describeError(new InstagramApiError(400, 100, "bad"))).toBe("Instagram 400/100: bad");
    expect(describeError(new Error("boom"))).toBe("boom");
  });
});
