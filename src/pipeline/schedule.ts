import type { SQL } from "bun";
import { z } from "zod";
import { instagramUsername } from "../instagram/client";

// Schedule for automatic collection (table pipeline_schedule, set from the admin menu).
export interface Schedule {
  enabled: boolean;
  account: string;
  run_times: string[]; // "HH:MM" in WITA
  auto_publish: boolean;
  last_collected_at: Date | null;
}

// Lombok time (Asia/Makassar) has no daylight saving.
const WITA_OFFSET_MS = 8 * 3_600_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// "7, 19:30 07:00" -> ["07:00", "19:30"]
export const runTimesInput = z
  .string()
  .transform((v) => v.split(/[\s,]+/).filter(Boolean))
  .pipe(
    z
      .array(
        z
          .string()
          .regex(/^([01]?\d|2[0-3])(:[0-5]\d)?$/, "use HH:MM in WITA, e.g. 07:00")
          .transform((t) => {
            const [h = "", m = "00"] = t.split(":");
            return `${h.padStart(2, "0")}:${m}`;
          }),
      )
      .min(1, "give at least one time")
      .max(24),
  )
  .transform((times) => [...new Set(times)].sort());

export const scheduleInput = z.object({
  account: instagramUsername,
  run_times: runTimesInput,
  auto_publish: z.boolean(),
});

// The run_times slots of the WITA day `dayOffset` days from now's WITA day, as instants.
function slots(runTimes: string[], now: Date, dayOffset: number): number[] {
  const wita = new Date(now.getTime() + WITA_OFFSET_MS);
  return runTimes.map((t) => {
    const [h, m] = t.split(":").map(Number);
    return Date.UTC(wita.getUTCFullYear(), wita.getUTCMonth(), wita.getUTCDate() + dayOffset, h, m) - WITA_OFFSET_MS;
  });
}

// Most recent scheduled time at or before now (today or yesterday, WITA).
export function latestSlot(runTimes: string[], now: Date): Date {
  return new Date(Math.max(...[...slots(runTimes, now, -1), ...slots(runTimes, now, 0)].filter((s) => s <= now.getTime())));
}

// First scheduled time after now (today or tomorrow, WITA).
export function nextSlot(runTimes: string[], now: Date): Date {
  return new Date(Math.min(...[...slots(runTimes, now, 0), ...slots(runTimes, now, 1)].filter((s) => s > now.getTime())));
}

export const formatWita = (date: Date) => `${new Date(date.getTime() + WITA_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ")} WITA`;

// Due when a scheduled time has passed that the last collect did not cover yet.
export function isCollectDue(schedule: Schedule, now: Date): boolean {
  if (!schedule.enabled) return false;
  return schedule.last_collected_at === null || schedule.last_collected_at < latestSlot(schedule.run_times, now);
}

// Collect everything since the last collect, with an hour of overlap (known posts are skipped anyway).
// Never further back than a week, e.g. after the schedule was off for a long time; the first run takes one day.
export function collectSinceFor(schedule: Schedule, now: Date): Date {
  if (!schedule.last_collected_at) return new Date(now.getTime() - DAY_MS);
  return new Date(Math.max(schedule.last_collected_at.getTime() - HOUR_MS, now.getTime() - 7 * DAY_MS));
}

export async function loadSchedule(sql: SQL): Promise<Schedule | null> {
  const [row] = await sql`select enabled, account, run_times, auto_publish, last_collected_at from public.pipeline_schedule`;
  return row ?? null;
}

// Creates or replaces the schedule and turns it on; last_collected_at is kept.
export async function saveSchedule(sql: SQL, input: z.infer<typeof scheduleInput>) {
  await sql`
    insert into public.pipeline_schedule (account, run_times, auto_publish)
    values (${input.account}, ${input.run_times}, ${input.auto_publish})
    on conflict (id) do update
    set account = excluded.account, run_times = excluded.run_times, auto_publish = excluded.auto_publish, enabled = true
  `;
}

// Returns false when there is no schedule to switch.
export async function setScheduleEnabled(sql: SQL, enabled: boolean): Promise<boolean> {
  const result = await sql`update public.pipeline_schedule set enabled = ${enabled}`;
  return result.count > 0;
}

export async function markCollected(sql: SQL, at: Date) {
  await sql`update public.pipeline_schedule set last_collected_at = ${at}`;
}
