// Read-only probe: checks whether Business Discovery can read a target account's posts.
// Prints a summary only; nothing is stored. See docs/instagram-access.md.
//
// Usage: bun scripts/check-instagram.ts [username]   (default: lokerlombok)
// Requires IG_USER_ID and IG_ACCESS_TOKEN in .env.

const username = Bun.argv[2] ?? "lokerlombok";
const { IG_USER_ID, IG_ACCESS_TOKEN } = Bun.env;
if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
  console.error("Set IG_USER_ID and IG_ACCESS_TOKEN in .env first.");
  process.exit(1);
}

const media = "id,caption,media_type,media_url,permalink,timestamp,children{media_type,media_url}";
const fields = `business_discovery.username(${username}){username,name,media_count,media.limit(5){${media}}}`;
const url = `https://graph.facebook.com/${IG_USER_ID}?fields=${encodeURIComponent(fields)}`;

// Token goes in a header so it never appears in printed URLs or errors.
const res = await fetch(url, { headers: { Authorization: `Bearer ${IG_ACCESS_TOKEN}` } });
const body = (await res.json()) as any;

if (!res.ok) {
  const e = body.error ?? {};
  console.error(`Request failed (${res.status}): [${e.code}/${e.error_subcode ?? "-"}] ${e.message}`);
  process.exit(1);
}

const account = body.business_discovery;
console.log(`Account: @${account.username} (${account.name ?? "-"}), media_count=${account.media_count}`);
for (const m of account.media?.data ?? []) {
  console.log(
    [
      m.timestamp,
      m.media_type,
      `caption=${m.caption ? `${m.caption.length} chars` : "none"}`,
      `media_url=${m.media_url ? "yes" : "no"}`,
      `children=${m.children?.data.length ?? 0}`,
      m.permalink,
    ].join(" | "),
  );
}
console.log(`Next page cursor: ${account.media?.paging?.cursors?.after ? "yes" : "no"}`);
