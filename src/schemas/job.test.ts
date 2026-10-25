import { describe, expect, test } from "bun:test";
import { jobInsertSchema, jobSchema } from "./job";

const minimalJob = {
  title: "Staff Admin",
  source_account: "lokerlombok",
  source_post_url: "https://www.instagram.com/p/ABC123/",
  source_post_id: "ABC123",
};

describe("jobInsertSchema", () => {
  test("accepts minimal input and fills nulls and defaults", () => {
    const job = jobInsertSchema.parse(minimalJob);
    expect(job).toMatchObject({
      title: "Staff Admin",
      company_name: null,
      location: null,
      requirements: null,
      employment_type: null,
      salary_min: null,
      salary_max: null,
      deadline: null,
      source_platform: "instagram",
      source_job_index: 0,
      source_posted_at: null,
      extraction_status: "pending",
      publication_status: "draft",
    });
  });

  test("accepts a fully filled job", () => {
    const result = jobInsertSchema.safeParse({
      ...minimalJob,
      company_name: "PT Contoh Lombok",
      location: "Mataram",
      description: "Mengelola administrasi kantor.",
      requirements: ["Minimal SMA/SMK", "Bisa Microsoft Office"],
      employment_type: "full_time",
      education_level: "sma_smk",
      salary_min: 2_500_000,
      salary_max: 3_000_000,
      salary_text: "Rp2,5 - 3 juta",
      deadline: "2026-11-30",
      source_posted_at: "2026-10-20T08:00:00+08:00",
      raw_caption: "Dibutuhkan Staff Admin...",
      ocr_text: "LOWONGAN KERJA STAFF ADMIN",
      extraction_status: "extracted",
      publication_status: "published",
    });
    expect(result.success).toBe(true);
  });

  test("trims text and rejects blank required fields", () => {
    expect(jobInsertSchema.parse({ ...minimalJob, title: "  Kasir  " }).title).toBe("Kasir");
    expect(jobInsertSchema.safeParse({ ...minimalJob, title: "   " }).success).toBe(false);
  });

  test.each(["title", "source_account", "source_post_url", "source_post_id"])("requires %s", (field) => {
    const input: Record<string, unknown> = { ...minimalJob };
    delete input[field];
    expect(jobInsertSchema.safeParse(input).success).toBe(false);
  });

  test("rejects salary_min greater than salary_max", () => {
    const result = jobInsertSchema.safeParse({ ...minimalJob, salary_min: 5_000_000, salary_max: 3_000_000 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["salary_min"]);
  });

  test("rejects negative or fractional salary", () => {
    expect(jobInsertSchema.safeParse({ ...minimalJob, salary_min: -1 }).success).toBe(false);
    expect(jobInsertSchema.safeParse({ ...minimalJob, salary_min: 1.5 }).success).toBe(false);
  });

  test("accepts several jobs from one post and rejects invalid source_job_index", () => {
    expect(jobInsertSchema.parse({ ...minimalJob, source_job_index: 2 }).source_job_index).toBe(2);
    expect(jobInsertSchema.safeParse({ ...minimalJob, source_job_index: -1 }).success).toBe(false);
    expect(jobInsertSchema.safeParse({ ...minimalJob, source_job_index: 0.5 }).success).toBe(false);
  });

  test("rejects invalid enum values", () => {
    expect(jobInsertSchema.safeParse({ ...minimalJob, employment_type: "fulltime" }).success).toBe(false);
    expect(jobInsertSchema.safeParse({ ...minimalJob, education_level: "SMA" }).success).toBe(false);
    expect(jobInsertSchema.safeParse({ ...minimalJob, publication_status: "live" }).success).toBe(false);
  });

  test("rejects invalid dates and urls", () => {
    expect(jobInsertSchema.safeParse({ ...minimalJob, deadline: "30-11-2026" }).success).toBe(false);
    expect(jobInsertSchema.safeParse({ ...minimalJob, source_posted_at: "2026-10-20" }).success).toBe(false);
    expect(jobInsertSchema.safeParse({ ...minimalJob, source_post_url: "not a url" }).success).toBe(false);
    expect(jobInsertSchema.safeParse({ ...minimalJob, source_post_url: "http://instagram.com/p/x" }).success).toBe(false);
  });

  test("rejects unknown fields", () => {
    expect(jobInsertSchema.safeParse({ ...minimalJob, id: "x" }).success).toBe(false);
  });
});

describe("jobSchema", () => {
  test("accepts a database row", () => {
    const row = {
      ...jobInsertSchema.parse(minimalJob),
      id: "3f1c2b8e-9a4d-4c6e-8b2a-1d5e7f9a0b3c",
      created_at: "2026-10-25T10:00:00.123456+00:00",
      updated_at: "2026-10-25T10:00:00.123456+00:00",
    };
    expect(jobSchema.safeParse(row).success).toBe(true);
  });

  test("rejects a row without id", () => {
    expect(jobSchema.safeParse(jobInsertSchema.parse(minimalJob)).success).toBe(false);
  });
});
