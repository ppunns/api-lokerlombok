import { describe, expect, test } from "bun:test";
import type { InstagramMedia } from "../instagram/client";
import { toSourcePost } from "./collect";

const base: InstagramMedia = {
  id: "1801",
  media_type: "IMAGE",
  permalink: "https://www.instagram.com/p/AAA/",
  timestamp: "2026-10-25T11:50:30+0000",
};

describe("toSourcePost", () => {
  test("maps a single image post", () => {
    expect(toSourcePost({ ...base, caption: " Hai Semeton ", media_url: "https://cdn/1.jpg" }, "lokerlombok")).toEqual({
      source_account: "lokerlombok",
      source_post_id: "1801",
      source_post_url: "https://www.instagram.com/p/AAA/",
      source_posted_at: "2026-10-25T11:50:30+0000",
      media_type: "IMAGE",
      caption: "Hai Semeton",
      media_urls: ["https://cdn/1.jpg"],
    });
  });

  test("uses carousel children and skips missing urls", () => {
    const post = toSourcePost(
      {
        ...base,
        media_type: "CAROUSEL_ALBUM",
        media_url: "https://cdn/cover.jpg",
        children: { data: [{ media_type: "IMAGE", media_url: "https://cdn/a.jpg" }, { media_type: "VIDEO" }] },
      },
      "lokerlombok",
    );
    expect(post.media_urls).toEqual(["https://cdn/a.jpg"]);
  });

  test("stores blank caption as null and video without url as empty list", () => {
    const post = toSourcePost({ ...base, media_type: "VIDEO", caption: "   " }, "lokerlombok");
    expect(post.caption).toBeNull();
    expect(post.media_urls).toEqual([]);
  });
});
