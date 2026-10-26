// Automatic pipeline: collect new Instagram posts, then extract jobs with Gemini
// (published right away unless AUTO_PUBLISH=false, which keeps them as drafts for review).
// Usage:
//   bun scripts/pipeline.ts          keep running, one round on PIPELINE_CRON (default every 15 minutes)
//   bun scripts/pipeline.ts --once   run a single round and exit (for an external scheduler)
import { connectDb, POOL_MAX } from "../src/db";
import { z } from "zod";
import { config } from "../src/config";
import { createGeminiExtractor, withFallback } from "../src/extraction/gemini";
import { createInstagramClient } from "../src/instagram/client";
import { runPipelineOnce } from "../src/pipeline/run";

const env = z
  .object({
    IG_USER_ID: z.string().regex(/^\d+$/),
    IG_ACCESS_TOKEN: z.string().min(1),
    IG_TARGET_USERNAME: z.string().min(1).default("lokerlombok"),
    GEMINI_API_KEY: z.string().min(1),
    GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
    GEMINI_FALLBACK_MODEL: z.string().default("gemini-3.5-flash-lite"),
    PIPELINE_CRON: z.string().default("*/15 * * * *"),
    EXTRACT_BATCH: z.coerce.number().int().min(1).max(100).default(20),
    // true: AI-extracted jobs go public immediately; false: they stay drafts until `bun run review publish`.
    AUTO_PUBLISH: z.stringbool().default(true),
  })
  .parse(Bun.env);

const sql = connectDb(config.adminDatabaseUrl(), POOL_MAX.worker);
const client = createInstagramClient({ igUserId: env.IG_USER_ID, accessToken: env.IG_ACCESS_TOKEN });
const { extract, usage } = withFallback(
  createGeminiExtractor({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
  createGeminiExtractor({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_FALLBACK_MODEL }),
);

async function round() {
  const started = new Date().toISOString();
  const r = await runPipelineOnce({ sql, client, username: env.IG_TARGET_USERNAME, extract, extractLimit: env.EXTRACT_BATCH, autoPublish: env.AUTO_PUBLISH });
  if (r.skipped) {
    console.log(`[${started}] skipped: another pipeline run is still in progress`);
    return true;
  }
  console.log(
    `[${started}] collect: ${r.collectError ? `FAILED ${r.collectError}` : JSON.stringify(r.collect)}` +
      ` | extract: ${r.extractError ? `FAILED ${r.extractError}` : JSON.stringify(r.extract)}` +
      ` | expired: ${r.expireError ? `FAILED ${r.expireError}` : r.expired}` +
      ` | models (total): ${env.GEMINI_MODEL}=${usage.primary}, ${env.GEMINI_FALLBACK_MODEL}=${usage.fallback}`,
  );
  return !r.collectError && !r.extractError && !r.expireError;
}

if (Bun.argv.includes("--once")) {
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
    `Pipeline for @${env.IG_TARGET_USERNAME} on "${env.PIPELINE_CRON}" (model ${env.GEMINI_MODEL}, fallback on 503: ${env.GEMINI_FALLBACK_MODEL}, ${env.AUTO_PUBLISH ? "auto-publish" : "drafts for review"})`,
  );
  await tick();
  Bun.cron(env.PIPELINE_CRON, tick);
}
