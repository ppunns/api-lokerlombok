// Checks that API_DATABASE_URL connects as the read-only API role. Changes nothing:
// write attempts match no rows and are rolled back. Never prints the connection string.
// Usage: bun scripts/check-api-role.ts
import { connectDb } from "../src/db";
import { checkReadOnlyAccess } from "../src/jobs/readonly-check";

const url = Bun.env.API_DATABASE_URL;
if (!url) {
  console.error("API_DATABASE_URL is not set.");
  process.exit(1);
}

const sql = connectDb(url, 1);
try {
  const checks = await checkReadOnlyAccess(sql);
  for (const c of checks) console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed ? `${failed} check(s) failed: do not switch the API yet.` : "All checks passed.");
  process.exitCode = failed ? 1 : 0;
} finally {
  await sql.close();
}
