import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import type { JobsRepository } from "./jobs/repository";

const failingRepo: JobsRepository = {
  search: () => Promise.reject(new Error("db down")),
  findPublishedById: () => Promise.reject(new Error("db down")),
};
const app = createApp({ jobs: failingRepo });

describe("app", () => {
  test("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("unknown route returns 404 JSON", async () => {
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
  });

  test("errors return 500 JSON without leaking details", async () => {
    const res = await app.request("/jobs");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
  });
});
