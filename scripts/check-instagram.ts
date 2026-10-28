// Read-only probe: checks whether Business Discovery can read a target account's profile and posts.
// Prints a summary only; nothing is stored. See docs/instagram-access.md.
//
// Usage: bun scripts/check-instagram.ts [username]   (default: DEFAULT_TARGET_USERNAME)
// Requires IG_USER_ID and IG_ACCESS_TOKEN in .env.
import { DEFAULT_TARGET_USERNAME, instagramUsername } from "../src/instagram/client";

const parsedName = instagramUsername.safeParse(Bun.argv[2] ?? DEFAULT_TARGET_USERNAME);
if (!parsedName.success) {
  console.error(`"${Bun.argv[2]}" is not a valid Instagram username.`);
  process.exit(1);
}
const username = parsedName.data;
const { IG_USER_ID, IG_ACCESS_TOKEN } = Bun.env;
if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
  console.error("Set IG_USER_ID and IG_ACCESS_TOKEN in .env first.");
  process.exit(1);
}

const media = "id,caption,media_type,media_url,permalink,timestamp,children{media_type,media_url}";
const profile = "username,name,biography,website,followers_count,media_count";
const fields = `business_discovery.username(${username}){${profile},media.limit(5){${media}}}`;
const url = `https://graph.facebook.com/${IG_USER_ID}?fields=${encodeURIComponent(fields)}`;

// Token goes in a header so it never appears in printed URLs or errors.
const res = await fetch(url, { headers: { Authorization: `Bearer ${IG_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
const body = (await res.json().catch(() => ({}))) as any;

if (!res.ok) {
  const e = body.error ?? {};
  console.error(`Request failed (${res.status}): [${e.code}/${e.error_subcode ?? "-"}] ${e.message ?? "no error message"}`);
  // Business Discovery only sees Business/Creator accounts; personal or unknown accounts fail like this.
  if (e.code === 110 || e.code === 100) console.error(`@${username} was not found, or it is not a Business/Creator account.`);
  process.exit(1);
}

const account = body.business_discovery;
console.log(`@${account.username}${account.name ? ` (${account.name})` : ""}`);
if (account.biography) console.log(`Bio: ${account.biography.replace(/\s*\n\s*/g, " / ")}`);
if (account.website) console.log(`Website: ${account.website}`);
console.log(`Followers: ${account.followers_count ?? "-"} · Posts: ${account.media_count ?? "-"}`);

const posts = account.media?.data ?? [];
console.log(posts.length ? "\nLatest posts:" : "\nNo posts visible.");
for (const m of posts) {
  const caption = m.caption ? m.caption.replace(/\s+/g, " ").slice(0, 70) : "(no caption)";
  const images = m.children?.data.length ?? (m.media_url ? 1 : 0);
  console.log(`  ${m.timestamp.slice(0, 10)}  ${m.media_type} (${images} media)  ${caption}`);
  console.log(`              ${m.permalink}`);
}
