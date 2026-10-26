// Review AI-extracted jobs before they become public.
// Usage:
//   bun scripts/review.ts                    list draft jobs grouped by post
//   bun scripts/review.ts show <id>          show one job in full
//   bun scripts/review.ts publish <id...>    make jobs public
//   bun scripts/review.ts reject <id...>     hide jobs (also unpublishes)
// <id> can be the first 8 characters shown in the list.
import { connectDb, POOL_MAX } from "../src/db";
import { config } from "../src/config";
import { getJob, listDrafts, resolveJobIds, setPublicationStatus } from "../src/jobs/review";

const [command = "list", ...args] = Bun.argv.slice(2);
const sql = connectDb(config.adminDatabaseUrl(), POOL_MAX.worker);

try {
  if (command === "list") {
    const drafts = await listDrafts(sql);
    let lastPost = "";
    for (const job of drafts) {
      if (job.source_post_id !== lastPost) {
        console.log(`\n${job.source_post_url}  (${job.source_posted_at?.toISOString().slice(0, 10) ?? "-"})`);
        lastPost = job.source_post_id;
      }
      const deadline = job.deadline ? `deadline ${job.deadline}${job.deadline_passed ? " ⚠ lewat" : ""}` : "";
      const details = [job.company_name, job.location, job.salary_text, deadline].filter(Boolean).join(" · ");
      console.log(`  ${job.id.slice(0, 8)}  ${job.title}${details ? `  —  ${details}` : ""}`);
    }
    console.log(drafts.length ? `\n${drafts.length} draft(s).` : "No draft jobs.");
  } else if (command === "show") {
    const [id] = await resolveJobIds(sql, args.slice(0, 1));
    const job = await getJob(sql, id!);
    for (const [key, value] of Object.entries(job)) {
      const text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map((v) => `\n    - ${v}`).join("") : value;
      console.log(`${key}: ${text ?? "-"}`);
    }
  } else if (command === "publish" || command === "reject") {
    if (args.length === 0) throw new Error(`usage: ${command} <id...>`);
    const ids = await resolveJobIds(sql, args);
    const count = await setPublicationStatus(sql, ids, command === "publish" ? "published" : "rejected");
    console.log(`${command === "publish" ? "Published" : "Rejected"} ${count} job(s).`);
  } else {
    throw new Error(`unknown command "${command}" (use list, show, publish, reject)`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.close();
}
