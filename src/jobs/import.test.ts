import { describe, expect, test } from "bun:test";
import { SAMPLE_SOURCE_ACCOUNT, validateJobs } from "./import";

const job = {
  title: "Staff Admin",
  source_account: "lokerlombok",
  source_post_url: "https://www.instagram.com/p/ABC123/",
  source_post_id: "ABC123",
};

describe("validateJobs", () => {
  test("accepts valid jobs and applies defaults", () => {
    const result = validateJobs([job, { ...job, title: "Kasir", source_job_index: 1 }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.jobs).toHaveLength(2);
      expect(result.jobs[0]).toMatchObject({ source_job_index: 0, publication_status: "draft", company_name: null });
    }
  });

  test("reports item index and field for invalid jobs", () => {
    const result = validateJobs([job, { ...job, source_job_index: 1, title: "", employment_type: "fulltime" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("1.title:"))).toBe(true);
      expect(result.errors.some((e) => e.startsWith("1.employment_type:"))).toBe(true);
    }
  });

  test("rejects duplicate source identity within the input", () => {
    const result = validateJobs([job, { ...job, title: "Kasir" }]);
    expect(result).toEqual({ ok: false, errors: ["1: duplicate source (instagram:ABC123#0) of item 0"] });
  });

  test("rejects empty or non-array input", () => {
    expect(validateJobs([]).ok).toBe(false);
    expect(validateJobs({ title: "x" }).ok).toBe(false);
  });

  test("bundled sample data is valid and marked as sample", async () => {
    const result = validateJobs(await Bun.file(`${import.meta.dir}/../../data/sample-jobs.json`).json());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.jobs.every((j) => j.source_account === SAMPLE_SOURCE_ACCOUNT)).toBe(true);
  });
});
