// Deletes ALL jobs and ALL collected Instagram posts (source_posts), to start over.
// Usage:
//   bun scripts/reset.ts         show what would be deleted, change nothing
//   bun scripts/reset.ts --yes   delete it
// Afterwards the next collect fetches recent posts again (up to 100) and extraction runs on them again.
import { connectDb, POOL_MAX } from "../src/db";
import { config } from "../src/config";
import { countData, resetAll } from "../src/jobs/reset";

const url = config.adminDatabaseUrl();
const sql = connectDb(url, POOL_MAX.worker);

try {
  // Host only, never the credentials, so it is clear which database is about to be emptied.
  console.log(`Database: ${new URL(url).host}`);
  if (Bun.argv.includes("--yes")) {
    const deleted = await resetAll(sql);
    console.log(`Deleted ${deleted.jobs} job(s) and ${deleted.source_posts} source post(s).`);
  } else {
    const counts = await countData(sql);
    console.log(`Would delete ${counts.jobs} job(s) and ${counts.source_posts} source post(s).`);
    console.log("Nothing was changed. Run again with --yes to delete everything.");
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.close();
}
