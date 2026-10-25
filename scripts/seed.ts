// Usage:
//   bun scripts/seed.ts [file.json]   validate and upsert jobs (default: data/sample-jobs.json)
//   bun scripts/seed.ts --clean       delete sample jobs (source_account = contoh_data)
import { SQL } from "bun";
import { config } from "../src/config";
import { SAMPLE_SOURCE_ACCOUNT, upsertJobs, validateJobs } from "../src/jobs/import";

const arg = Bun.argv[2];
const sql = new SQL(config.DATABASE_URL);

try {
  if (arg === "--clean") {
    const result = await sql`delete from public.jobs where source_account = ${SAMPLE_SOURCE_ACCOUNT}`;
    console.log(`Deleted ${result.count} sample job(s).`);
  } else {
    const path = arg ?? "data/sample-jobs.json";
    const result = validateJobs(await Bun.file(path).json());
    if (!result.ok) {
      console.error(`Validation failed for ${path}, nothing was saved:`);
      for (const error of result.errors) console.error(`  - ${error}`);
      process.exitCode = 1;
    } else {
      const count = await upsertJobs(sql, result.jobs);
      console.log(`Upserted ${count} job(s) from ${path}.`);
    }
  }
} finally {
  await sql.close();
}
