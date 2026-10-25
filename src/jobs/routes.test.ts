import { describe, expect, test } from "bun:test";
import { createApp } from "../app";
import type { JobSearchQuery, PublicJob } from "../schemas/job";
import { toLikePattern, type JobsRepository } from "./repository";

const job: PublicJob = {
  id: "3f1c2b8e-9a4d-4c6e-8b2a-1d5e7f9a0b3c",
  title: "Staff Admin",
  company_name: "PT Contoh Lombok",
  location: "Mataram",
  description: null,
  requirements: null,
  employment_type: "full_time",
  education_level: "sma_smk",
  salary_min: null,
  salary_max: null,
  salary_text: null,
  deadline: null,
  source_platform: "instagram",
  source_account: "lokerlombok",
  source_post_url: "https://www.instagram.com/p/ABC123/",
  source_post_id: "ABC123",
  source_job_index: 0,
  source_posted_at: null,
  created_at: "2026-10-25T10:00:00.000Z",
  updated_at: "2026-10-25T10:00:00.000Z",
};

function setup(total = 1) {
  const calls: JobSearchQuery[] = [];
  const repo: JobsRepository = {
    search: async (query) => {
      calls.push(query);
      return { jobs: [job], total };
    },
    findPublishedById: async (id) => (id === job.id ? job : null),
  };
  return { app: createApp({ jobs: repo }), calls };
}

describe("GET /jobs", () => {
  test("uses default pagination", async () => {
    const { app, calls } = setup(45);
    const res = await app.request("/jobs");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [job],
      pagination: { page: 1, limit: 20, total: 45, total_pages: 3 },
    });
    expect(calls[0]).toEqual({ page: 1, limit: 20 });
  });

  test("passes validated filters to the repository", async () => {
    const { app, calls } = setup();
    const res = await app.request(
      "/jobs?q=%20admin%20&location=Mataram&employment_type=full_time&education_level=s1&page=2&limit=10&utm=x",
    );
    expect(res.status).toBe(200);
    expect(calls[0]).toEqual({
      q: "admin",
      location: "Mataram",
      employment_type: "full_time",
      education_level: "s1",
      page: 2,
      limit: 10,
    });
  });

  test("treats blank filters as absent", async () => {
    const { app, calls } = setup();
    await app.request("/jobs?q=&location=%20");
    expect(calls[0]).toEqual({ page: 1, limit: 20 });
  });

  test.each([
    ["page=0", "page"],
    ["limit=51", "limit"],
    ["page=abc", "page"],
    ["employment_type=fulltime", "employment_type"],
    [`q=${"a".repeat(101)}`, "q"],
  ])("rejects invalid query %s", async (query, field) => {
    const { app, calls } = setup();
    const res = await app.request(`/jobs?${query}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: Record<string, unknown> };
    expect(body.error).toBe("Invalid query");
    expect(body.details).toHaveProperty(field);
    expect(calls).toHaveLength(0);
  });
});

describe("GET /jobs/:id", () => {
  test("returns a published job", async () => {
    const { app } = setup();
    const res = await app.request(`/jobs/${job.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: job });
  });

  test("returns 404 for unknown or unpublished job", async () => {
    const { app } = setup();
    const res = await app.request("/jobs/00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Job not found" });
  });

  test("returns 400 for invalid id", async () => {
    const { app } = setup();
    const res = await app.request("/jobs/not-a-uuid");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid job id" });
  });
});

describe("toLikePattern", () => {
  test("wraps value and escapes LIKE wildcards", () => {
    expect(toLikePattern("admin")).toBe("%admin%");
    expect(toLikePattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });
});
