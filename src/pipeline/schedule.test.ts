import { describe, expect, test } from "bun:test";
import { collectSinceFor, formatWita, isCollectDue, latestSlot, nextSlot, runTimesInput, type Schedule } from "./schedule";

const at = (iso: string) => new Date(iso);
const schedule = (o: Partial<Schedule> = {}): Schedule => ({
  enabled: true,
  account: "bursalokerlombok",
  run_times: ["07:00", "19:00"],
  auto_publish: true,
  last_collected_at: null,
  ...o,
});

describe("run times input", () => {
  test("normalizes, dedupes and sorts", () => {
    expect(runTimesInput.parse("19:00, 7 07:00,12:30")).toEqual(["07:00", "12:30", "19:00"]);
  });

  test("rejects invalid or empty input", () => {
    for (const bad of ["", "24:00", "7:60", "jam 7", "07.00"]) expect(runTimesInput.safeParse(bad).success).toBe(false);
  });
});

describe("slots in WITA (UTC+8)", () => {
  test("latest and next slot during the day", () => {
    const now = at("2026-10-28T03:30:00Z"); // 11:30 WITA
    expect(latestSlot(["07:00", "19:00"], now)).toEqual(at("2026-10-27T23:00:00Z")); // 07:00 WITA today
    expect(nextSlot(["07:00", "19:00"], now)).toEqual(at("2026-10-28T11:00:00Z")); // 19:00 WITA today
  });

  test("before the first time of the day, the latest slot is yesterday's", () => {
    const now = at("2026-10-27T22:00:00Z"); // 06:00 WITA on the 28th
    expect(latestSlot(["07:00", "19:00"], now)).toEqual(at("2026-10-27T11:00:00Z")); // 19:00 WITA on the 27th
    expect(nextSlot(["07:00", "19:00"], now)).toEqual(at("2026-10-27T23:00:00Z"));
  });

  test("a slot exactly now counts as passed", () => {
    expect(latestSlot(["07:00"], at("2026-10-27T23:00:00Z"))).toEqual(at("2026-10-27T23:00:00Z"));
  });

  test("formats in WITA", () => {
    expect(formatWita(at("2026-10-28T11:00:00Z"))).toBe("2026-10-28 19:00 WITA");
  });
});

describe("isCollectDue", () => {
  const now = at("2026-10-28T03:30:00Z"); // 11:30 WITA, latest slot 07:00 WITA

  test("due when never collected or the last collect was before the latest slot", () => {
    expect(isCollectDue(schedule(), now)).toBe(true);
    expect(isCollectDue(schedule({ last_collected_at: at("2026-10-27T22:59:00Z") }), now)).toBe(true);
  });

  test("not due when the latest slot was already collected, or when off", () => {
    expect(isCollectDue(schedule({ last_collected_at: at("2026-10-27T23:10:00Z") }), now)).toBe(false);
    expect(isCollectDue(schedule({ enabled: false }), now)).toBe(false);
  });
});

describe("collectSinceFor", () => {
  const now = at("2026-10-28T03:30:00Z");

  test("first run takes one day; later runs since the last collect minus an hour", () => {
    expect(collectSinceFor(schedule(), now)).toEqual(at("2026-10-27T03:30:00Z"));
    expect(collectSinceFor(schedule({ last_collected_at: at("2026-10-27T11:00:00Z") }), now)).toEqual(at("2026-10-27T10:00:00Z"));
  });

  test("never further back than a week", () => {
    expect(collectSinceFor(schedule({ last_collected_at: at("2026-09-01T00:00:00Z") }), now)).toEqual(at("2026-10-21T03:30:00Z"));
  });
});
