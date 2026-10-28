// Automatic pipeline: collect new Instagram posts, then extract jobs with Gemini
// (published right away unless AUTO_PUBLISH=false, which keeps them as drafts for review).
// Usage:
//   bun scripts/pipeline.ts          keep running, one round on PIPELINE_CRON (default every 15 minutes)
//   bun scripts/pipeline.ts --once   run a single round and exit (for an external scheduler)
//   bun scripts/pipeline.ts --once --account <username> --days <1-30>
//                                    manual backfill: every post of that account from the last days,
//                                    then extract up to BACKFILL_EXTRACT_LIMIT pending posts
//   --publish / --draft              publish extracted jobs right away or keep them as drafts (overrides AUTO_PUBLISH)
// Without --account/--days/--publish/--draft, a round follows the schedule from `bun scripts/schedule.ts`
// (account, times, publish or draft) once one is set; otherwise it collects every round as before.
import { connectDb, POOL_MAX } from "../src/db";
import { z } from "zod";
import { config } from "../src/config";
import { createGeminiExtractor, withFallback } from "../src/extraction/gemini";
import { createInstagramClient, DEFAULT_TARGET_USERNAME, instagramUsername } from "../src/instagram/client";
import { runPipelineOnce } from "../src/pipeline/run";

const env = z
  .object({
    IG_USER_ID: z.string().regex(/^\d+$/),
    IG_ACCESS_TOKEN: z.string().min(1),
    IG_TARGET_USERNAME: instagramUsername.default(DEFAULT_TARGET_USERNAME),
    GEMINI_API_KEY: z.string().min(1),
    GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
    GEMINI_FALLBACK_MODEL: z.string().default("gemini-3.5-flash-lite"),
    PIPELINE_CRON: z.string().default("*/15 * * * *"),
    EXTRACT_BATCH: z.coerce.number().int().min(1).max(100).default(20),
    // true: AI-extracted jobs go public immediately; false: they stay drafts until `bun run review publish`.
    AUTO_PUBLISH: z.stringbool().default(true),
  })
  .parse(Bun.env);

const argValue = (name: string) => {
  const i = Bun.argv.indexOf(name);
  return i === -1 ? undefined : Bun.argv[i + 1];
};
const args = z
  .object({ account: instagramUsername.optional(), days: z.coerce.number().int().min(1).max(30).optional() })
  .parse({ account: argValue("--account"), days: argValue("--days") });
const once = Bun.argv.includes("--once");
if ((args.account || args.days) && !once) {
  console.error("--account and --days only work with --once");
  process.exit(1);
}
// A backfill can collect hundreds of posts; extract more of them than a regular round, still capped.
const BACKFILL_EXTRACT_LIMIT = 200;
const username = args.account ?? env.IG_TARGET_USERNAME;
const collectSince = args.days ? new Date(Date.now() - args.days * 86_400_000) : undefined;
const extractLimit = collectSince ? BACKFILL_EXTRACT_LIMIT : env.EXTRACT_BATCH;
// --publish / --draft override AUTO_PUBLISH for this run only.
if (Bun.argv.includes("--publish") && Bun.argv.includes("--draft")) {
  console.error("use either --publish or --draft, not both");
  process.exit(1);
}
const autoPublish = Bun.argv.includes("--publish") ? true : Bun.argv.includes("--draft") ? false : env.AUTO_PUBLISH;
// Regular rounds follow the schedule set in the admin menu (if any); a manual run with flags ignores it.
const useSchedule = !args.account && !args.days && !Bun.argv.includes("--publish") && !Bun.argv.includes("--draft");

const sql = connectDb(config.adminDatabaseUrl(), POOL_MAX.worker);
const client = createInstagramClient({ igUserId: env.IG_USER_ID, accessToken: env.IG_ACCESS_TOKEN });
const { extract, usage } = withFallback(
  createGeminiExtractor({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
  createGeminiExtractor({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_FALLBACK_MODEL }),
);

async function round() {
  const started = new Date().toISOString();
  const r = await runPipelineOnce({ sql, client, username, extract, extractLimit, autoPublish, collectSince, useSchedule });
  if (r.skipped) {
    console.log(`[${started}] skipped: another pipeline run is still in progress`);
    return true;
  }
  console.log(
    `[${started}] collect: ${r.collectError ? `FAILED ${r.collectError}` : r.collectSkipped ? `skipped (${r.collectSkipped})` : JSON.stringify(r.collect)}` +
      ` | extract: ${r.extractError ? `FAILED ${r.extractError}` : JSON.stringify(r.extract)}` +
      ` | expired: ${r.expireError ? `FAILED ${r.expireError}` : r.expired}` +
      ` | models (total): ${env.GEMINI_MODEL}=${usage.primary}, ${env.GEMINI_FALLBACK_MODEL}=${usage.fallback}`,
  );
  if (r.collect && "complete" in r.collect && !r.collect.complete) {
    console.log(`Note: stopped after ${r.collect.pages} pages; older posts in this period were not collected.`);
  }
  return !r.collectError && !r.extractError && !r.expireError;
}

if (once) {
  if (collectSince) {
    console.log(
      `Collecting @${username} posts since ${collectSince.toISOString()}, then extracting up to ${extractLimit} pending posts` +
        ` (${autoPublish ? "published right away" : "saved as drafts"}). This can take several minutes.`,
    );
  }
  const ok = await round();
  await sql.close();
  process.exit(ok ? 0 : 1);
} else {
  let running = false;
  const tick = async () => {
    if (running) return; // skip if the previous round is still going
    running = true;
    try {
      await round();
    } finally {
      running = false;
    }
  };
  console.log(
    `Pipeline for @${env.IG_TARGET_USERNAME} on "${env.PIPELINE_CRON}" (model ${env.GEMINI_MODEL}, fallback on 503: ${env.GEMINI_FALLBACK_MODEL}, ${autoPublish ? "auto-publish" : "drafts for review"})`,
  );
  await tick();
  Bun.cron(env.PIPELINE_CRON, tick);
}
