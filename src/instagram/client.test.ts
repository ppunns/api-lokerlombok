import { describe, expect, test } from "bun:test";
import { createInstagramClient, InstagramApiError } from "./client";

const TOKEN = "EAA-secret-token";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const mediaPage = {
  business_discovery: {
    media: {
      data: [
        {
          id: "1801",
          caption: "Hai Semeton",
          media_type: "IMAGE",
          media_url: "https://cdn.example/1.jpg",
          permalink: "https://www.instagram.com/p/AAA/",
          timestamp: "2026-10-25T11:50:30+0000",
        },
        {
          id: "1802",
          media_type: "VIDEO",
          permalink: "https://www.instagram.com/reel/BBB/",
          timestamp: "2026-10-25T11:40:00+0000",
        },
      ],
      paging: { cursors: { after: "CURSOR2" } },
    },
    id: "999",
  },
  id: "123",
};

describe("createInstagramClient", () => {
  test("requests business discovery with limit and cursor, token in header only", async () => {
    const { fn, calls } = fakeFetch(200, mediaPage);
    const client = createInstagramClient({ igUserId: "123", accessToken: TOKEN, fetch: fn });
    await client.fetchRecentMedia("lokerlombok", { limit: 25, after: "CURSOR1" });

    const url = decodeURIComponent(calls[0]!.url);
    expect(url).toStartWith("https://graph.facebook.com/123?fields=");
    expect(url).toContain("business_discovery.username(lokerlombok)");
    expect(url).toContain("media.limit(25).after(CURSOR1)");
    expect(url).not.toContain(TOKEN);
    expect(new Headers(calls[0]!.init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  test("parses media and next cursor, allowing missing caption and media_url", async () => {
    const client = createInstagramClient({ igUserId: "123", accessToken: TOKEN, fetch: fakeFetch(200, mediaPage).fn });
    const page = await client.fetchRecentMedia("lokerlombok", { limit: 25 });
    expect(page.after).toBe("CURSOR2");
    expect(page.media.map((m) => m.id)).toEqual(["1801", "1802"]);
    expect(page.media[1]?.media_url).toBeUndefined();
  });

  test("throws InstagramApiError with code on API errors", async () => {
    const { fn } = fakeFetch(400, { error: { code: 100, message: "Unsupported get request." } });
    const client = createInstagramClient({ igUserId: "123", accessToken: TOKEN, fetch: fn });
    const err = await client.fetchRecentMedia("x", { limit: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(InstagramApiError);
    expect(err).toMatchObject({ status: 400, code: 100, message: "Unsupported get request." });
  });

  test("times out a hanging request", async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const client = createInstagramClient({ igUserId: "123", accessToken: TOKEN, fetch: hanging, timeoutMs: 20 });
    const err = await client.fetchRecentMedia("x", { limit: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(InstagramApiError);
    expect(err).toMatchObject({ status: 408, code: undefined });
    expect(err.message).not.toContain(TOKEN);
  });

  test("keeps the HTTP status when an error body is not JSON", async () => {
    const fn = (async () => new Response("<html>Bad Gateway</html>", { status: 502 })) as unknown as typeof fetch;
    const client = createInstagramClient({ igUserId: "123", accessToken: TOKEN, fetch: fn });
    const err = await client.fetchRecentMedia("x", { limit: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(InstagramApiError);
    expect(err).toMatchObject({ status: 502, message: "Instagram API error (HTTP 502)" });
  });

  test("rejects unexpected response shapes", async () => {
    const client = createInstagramClient({ igUserId: "123", accessToken: TOKEN, fetch: fakeFetch(200, { id: "1" }).fn });
    expect(client.fetchRecentMedia("x", { limit: 1 })).rejects.toThrow();
  });
});
