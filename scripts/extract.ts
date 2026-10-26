// Extracts jobs from pending source_posts with Gemini; published right away unless AUTO_PUBLISH=false.
// Usage: bun scripts/extract.ts [--limit 20]
import { connectDb, POOL_MAX } from "../src/db";
import { z } from "zod";
import { config } from "../src/config";
import { createGeminiExtractor, withFallback } from "../src/extraction/gemini";
import { processPendingPosts } from "../src/extraction/process";

const env = z
  .object({
    GEMINI_API_KEY: z.string().min(1),
    GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
    GEMINI_FALLBACK_MODEL: z.string().default("gemini-3.5-flash-lite"),
    // true: AI-extracted jobs go public immediately; false: they stay drafts until `bun run review publish`.
    AUTO_PUBLISH: z.stringbool().default(true),
  })
  .parse(Bun.env);

const limitArg = Bun.argv.indexOf("--limit");
const limit = z.coerce.number().int().min(1).max(200).parse(limitArg === -1 ? 20 : Bun.argv[limitArg + 1]);

const sql = connectDb(config.adminDatabaseUrl(), POOL_MAX.worker);
try {
  const { extract, usage } = withFallback(
    createGeminiExtractor({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
    createGeminiExtractor({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_FALLBACK_MODEL }),
  );
  const result = await processPendingPosts({ sql, extract, limit, autoPublish: env.AUTO_PUBLISH });
  console.log(`${JSON.stringify(result)} (${env.AUTO_PUBLISH ? "published" : "saved as drafts"})`);
  console.log(`models: ${env.GEMINI_MODEL}=${usage.primary}, ${env.GEMINI_FALLBACK_MODEL} (fallback on 503)=${usage.fallback}`);
  if (result.stopped) console.log(`Stopped early (${result.stopped}): Gemini is busy or out of quota. Run again later.`);
} finally {
  await sql.close();
}
