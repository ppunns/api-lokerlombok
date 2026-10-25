// Automatic pipeline: collect new Instagram posts, then extract jobs (as drafts) with Gemini.
// Usage:
//   bun scripts/pipeline.ts          keep running, one round on PIPELINE_CRON (default every 15 minutes)
//   bun scripts/pipeline.ts --once   run a single round and exit (for an external scheduler)
import { SQL } from "bun";
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
  })
  .parse(Bun.env);

const sql = new SQL(config.DATABASE_URL);
const client = createInstagramClient({ igUserId: env.IG_USER_ID, accessToken: env.IG_ACCESS_TOKEN });
const { extract, usage } = withFallback(
  createGeminiExtractor({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
  createGeminiExtractor({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_FALLBACK_MODEL }),
);

async function round() {
  const started = new Date().toISOString();
  const r = await runPipelineOnce({ sql, client, username: env.IG_TARGET_USERNAME, extract, extractLimit: env.EXTRACT_BATCH });
  console.log(
    `[${started}] collect: ${r.collectError ? `FAILED ${r.collectError}` : JSON.stringify(r.collect)}` +
      ` | extract: ${r.extractError ? `FAILED ${r.extractError}` : JSON.stringify(r.extract)}` +
      ` | models (total): ${env.GEMINI_MODEL}=${usage.primary}, ${env.GEMINI_FALLBACK_MODEL}=${usage.fallback}`,
  );
  return !r.collectError && !r.extractError;
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
    `Pipeline for @${env.IG_TARGET_USERNAME} on "${env.PIPELINE_CRON}" (model ${env.GEMINI_MODEL}, fallback on 503: ${env.GEMINI_FALLBACK_MODEL})`,
  );
  await tick();
  Bun.cron(env.PIPELINE_CRON, tick);
}
