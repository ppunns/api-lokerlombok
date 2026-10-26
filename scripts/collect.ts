// Collects new Instagram posts into source_posts.
// Usage:
//   bun scripts/collect.ts           run once (for an external scheduler)
//   bun scripts/collect.ts --watch   keep running and poll on COLLECT_CRON (default every 15 minutes)
import { connectDb, POOL_MAX } from "../src/db";
import { z } from "zod";
import { collectNewPosts } from "../src/collector/collect";
import { config } from "../src/config";
import { createInstagramClient, InstagramApiError } from "../src/instagram/client";

const env = z
  .object({
    IG_USER_ID: z.string().regex(/^\d+$/),
    IG_ACCESS_TOKEN: z.string().min(1),
    IG_TARGET_USERNAME: z.string().min(1).default("lokerlombok"),
    COLLECT_CRON: z.string().default("*/15 * * * *"),
  })
  .parse(Bun.env);

const sql = connectDb(config.adminDatabaseUrl(), POOL_MAX.worker);
const client = createInstagramClient({ igUserId: env.IG_USER_ID, accessToken: env.IG_ACCESS_TOKEN });

async function runOnce() {
  const started = new Date().toISOString();
  try {
    const result = await collectNewPosts({ sql, client, username: env.IG_TARGET_USERNAME });
    console.log(`[${started}] @${env.IG_TARGET_USERNAME}: ${JSON.stringify(result)}`);
    return true;
  } catch (err) {
    const detail = err instanceof InstagramApiError ? `Instagram ${err.status}/${err.code}: ${err.message}` : String(err);
    console.error(`[${started}] collect failed: ${detail}`);
    return false;
  }
}

if (Bun.argv.includes("--watch")) {
  let running = false;
  const tick = async () => {
    if (running) return; // skip if the previous run is still going
    running = true;
    await runOnce();
    running = false;
  };
  console.log(`Polling @${env.IG_TARGET_USERNAME} on "${env.COLLECT_CRON}"`);
  await tick();
  Bun.cron(env.COLLECT_CRON, tick);
} else {
  const ok = await runOnce();
  await sql.close();
  process.exit(ok ? 0 : 1);
}
