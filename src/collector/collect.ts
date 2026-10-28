import type { SQL } from "bun";
import type { InstagramClient, InstagramMedia } from "../instagram/client";

export interface SourcePostInsert {
  source_account: string;
  source_post_id: string;
  source_post_url: string;
  source_posted_at: string;
  media_type: InstagramMedia["media_type"];
  caption: string | null;
  media_urls: string[];
}

export function toSourcePost(media: InstagramMedia, account: string): SourcePostInsert {
  // Carousels carry their images in children; single posts in media_url.
  const urls = media.children ? media.children.data.map((c) => c.media_url) : [media.media_url];
  return {
    source_account: account,
    source_post_id: media.id,
    source_post_url: media.permalink,
    source_posted_at: media.timestamp,
    media_type: media.media_type,
    caption: media.caption?.trim() || null,
    media_urls: urls.filter((u): u is string => !!u),
  };
}

export interface CollectOptions {
  sql: SQL;
  client: InstagramClient;
  username: string;
  pageSize?: number;
  // Caps how far back a run goes, e.g. on the first run when nothing is known yet.
  maxPages?: number;
}

// Stores the posts that are not in source_posts yet; returns how many were already known and inserted.
async function storeNewPosts(sql: SQL, media: InstagramMedia[], username: string) {
  if (media.length === 0) return { known: 0, inserted: 0 };
  const known = await sql`
    select source_post_id from public.source_posts
    where source_platform = 'instagram' and source_post_id in ${sql(media.map((m) => m.id))}
  `;
  const knownIds = new Set(known.map((r: { source_post_id: string }) => r.source_post_id));
  const fresh = media.filter((m) => !knownIds.has(m.id)).map((m) => toSourcePost(m, username));
  if (fresh.length === 0) return { known: knownIds.size, inserted: 0 };

  const result = await sql`
    insert into public.source_posts ${sql(fresh)}
    on conflict (source_platform, source_post_id) do nothing
  `;
  return { known: knownIds.size, inserted: result.count };
}

// Fetches newest posts page by page until a known post is reached, and stores the new ones.
export async function collectNewPosts({ sql, client, username, pageSize = 25, maxPages = 4 }: CollectOptions) {
  let after: string | undefined;
  let fetched = 0;
  let inserted = 0;
  let pages = 0;
  let reachedKnown = false;

  while (pages < maxPages) {
    const page = await client.fetchRecentMedia(username, { limit: pageSize, after });
    pages++;
    fetched += page.media.length;
    if (page.media.length === 0) break;

    const stored = await storeNewPosts(sql, page.media, username);
    inserted += stored.inserted;

    if (stored.known > 0) {
      reachedKnown = true;
      break;
    }
    if (!page.after) break;
    after = page.after;
  }

  return { fetched, inserted, pages, reachedKnown };
}

// Fetches every post newer than `since` (known posts are skipped, not a reason to stop) and stores
// the new ones. Used for a manual backfill of a chosen period, e.g. the last 7 days of an account.
// complete = false when maxPages ran out before reaching `since` or the end of the feed.
export async function collectPostsSince({ sql, client, username, since, pageSize = 25, maxPages = 20 }: CollectOptions & { since: Date }) {
  let after: string | undefined;
  let inRange = 0;
  let inserted = 0;
  let pages = 0;

  while (pages < maxPages) {
    const page = await client.fetchRecentMedia(username, { limit: pageSize, after });
    pages++;
    const recent = page.media.filter((m) => new Date(m.timestamp) >= since);
    inRange += recent.length;
    inserted += (await storeNewPosts(sql, recent, username)).inserted;

    // The feed is newest first, so an older post (or the end of the feed) means the period is covered.
    if (recent.length < page.media.length || !page.after) return { in_range: inRange, inserted, pages, complete: true };
    after = page.after;
  }

  return { in_range: inRange, inserted, pages, complete: false };
}
