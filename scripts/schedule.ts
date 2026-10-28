// Schedule for automatic collection by the pipeline (table pipeline_schedule).
// Usage:
//   bun scripts/schedule.ts                     show the schedule
//   bun scripts/schedule.ts set --account <username> --times 07:00,19:00 (--publish | --draft)
//   bun scripts/schedule.ts enable | disable    turn automatic collection on or off
// Times are WITA. The pipeline must be triggered often (Cloud Scheduler every 15 minutes, or
// `bun run pipeline`): it collects on the first trigger after each time.
import { connectDb, POOL_MAX } from "../src/db";
import { config } from "../src/config";
import { formatWita, isCollectDue, latestSlot, loadSchedule, nextSlot, saveSchedule, scheduleInput, setScheduleEnabled } from "../src/pipeline/schedule";

const [command = "show"] = Bun.argv.slice(2);
const argValue = (name: string) => {
  const i = Bun.argv.indexOf(name);
  return i === -1 ? undefined : Bun.argv[i + 1];
};

const sql = connectDb(config.adminDatabaseUrl(), POOL_MAX.worker);

async function show() {
  const s = await loadSchedule(sql);
  if (!s) {
    console.log("No schedule set: the pipeline collects on every trigger, using IG_TARGET_USERNAME and AUTO_PUBLISH.");
    return;
  }
  console.log(`Status:         ${s.enabled ? "on" : "OFF"}`);
  console.log(`Account:        @${s.account}`);
  console.log(`Times (WITA):   ${s.run_times.join(", ")}`);
  console.log(`Extracted jobs: ${s.auto_publish ? "published right away" : "saved as drafts"}`);
  console.log(`Last collect:   ${s.last_collected_at ? formatWita(s.last_collected_at) : "never"}`);
  const now = new Date();
  if (isCollectDue(s, now)) console.log(`Next collect:   on the next pipeline trigger (${formatWita(latestSlot(s.run_times, now))} has passed)`);
  else if (s.enabled) console.log(`Next collect:   ${formatWita(nextSlot(s.run_times, now))} (first pipeline trigger after it)`);
}

try {
  if (command === "show") {
    await show();
  } else if (command === "set") {
    const publish = Bun.argv.includes("--publish");
    if (publish === Bun.argv.includes("--draft")) throw new Error("choose one of --publish or --draft");
    const parsed = scheduleInput.safeParse({ account: argValue("--account"), run_times: argValue("--times"), auto_publish: publish });
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
    }
    await saveSchedule(sql, parsed.data);
    console.log("Schedule saved.\n");
    await show();
  } else if (command === "enable" || command === "disable") {
    if (!(await setScheduleEnabled(sql, command === "enable"))) throw new Error("no schedule yet: use set first");
    console.log(`Automatic collection turned ${command === "enable" ? "on" : "off"}.\n`);
    await show();
  } else {
    throw new Error(`unknown command "${command}" (use show, set, enable, disable)`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.close();
}
