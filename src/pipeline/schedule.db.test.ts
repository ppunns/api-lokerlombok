// Integration tests against a local Postgres with migrations applied; see README "Testing".
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { connectLocalTestDb, testDatabaseUrl } from "../testing/local-db";
import { loadSchedule, markCollected, saveSchedule, setScheduleEnabled } from "./schedule";

describe.skipIf(!testDatabaseUrl)("pipeline schedule (database)", () => {
  let sql: SQL;

  beforeAll(() => {
    sql = connectLocalTestDb();
  });
  beforeEach(async () => {
    await sql`truncate public.pipeline_schedule`;
  });
  afterAll(async () => {
    await sql?.close();
  });

  test("no schedule until one is set; enable/disable needs one", async () => {
    expect(await loadSchedule(sql)).toBeNull();
    expect(await setScheduleEnabled(sql, false)).toBe(false);
  });

  test("saves, switches off, and saving again turns it back on and keeps last_collected_at", async () => {
    await saveSchedule(sql, { account: "bursalokerlombok", run_times: ["07:00", "19:00"], auto_publish: false });
    expect(await loadSchedule(sql)).toEqual({
      enabled: true,
      account: "bursalokerlombok",
      run_times: ["07:00", "19:00"],
      auto_publish: false,
      last_collected_at: null,
    });

    const collectedAt = new Date("2026-10-28T03:30:00Z");
    await markCollected(sql, collectedAt);
    expect(await setScheduleEnabled(sql, false)).toBe(true);
    expect((await loadSchedule(sql))!.enabled).toBe(false);

    await saveSchedule(sql, { account: "lokerlombok", run_times: ["12:00"], auto_publish: true });
    expect(await loadSchedule(sql)).toEqual({
      enabled: true,
      account: "lokerlombok",
      run_times: ["12:00"],
      auto_publish: true,
      last_collected_at: collectedAt,
    });
    expect((await sql`select count(*)::int n from public.pipeline_schedule`)[0].n).toBe(1);
  });

  test("the table rejects invalid times and accounts", async () => {
    const insert = (account: string, times: string[]) =>
      sql`insert into public.pipeline_schedule (account, run_times) values (${account}, ${times})`;
    await expect(insert("bursalokerlombok", ["7:00"])).rejects.toThrow();
    await expect(insert("bursalokerlombok", [])).rejects.toThrow();
    await expect(insert("a){id}", ["07:00"])).rejects.toThrow();
  });
});
