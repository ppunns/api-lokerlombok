import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import type { JobsRepository } from "./jobs/repository";

const failingRepo: JobsRepository = {
  search: () => Promise.reject(new Error("db down")),
  findPublishedById: () => Promise.reject(new Error("db down")),
};
const pingDb = async () => {};
const app = createApp({ jobs: failingRepo, pingDb });

describe("app", () => {
  test("GET /health returns ok when the database answers", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("GET /health returns 503 when the database fails", async () => {
    const down = createApp({ jobs: failingRepo, pingDb: () => Promise.reject(new Error("connection refused")) });
    const res = await down.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable" });
  });

  test("GET /health returns 503 when the database does not answer in time", async () => {
    const hanging = createApp({ jobs: failingRepo, pingDb: () => new Promise(() => {}), healthTimeoutMs: 20 });
    const started = performance.now();
    const res = await hanging.request("/health");
    expect(res.status).toBe(503);
    expect(performance.now() - started).toBeLessThan(1000);
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

describe("CORS", () => {
  const repo: JobsRepository = {
    search: async () => ({ jobs: [], total: 0 }),
    findPublishedById: async () => null,
  };

  test("allows any origin by default for GET", async () => {
    const res = await createApp({ jobs: repo, pingDb }).request("/jobs", { headers: { Origin: "https://frontend.example" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("answers preflight with GET only", async () => {
    const res = await createApp({ jobs: repo, pingDb }).request("/jobs", {
      method: "OPTIONS",
      headers: { Origin: "https://frontend.example", "Access-Control-Request-Method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("restricts to configured origins", async () => {
    const app = createApp({ jobs: repo, pingDb, corsOrigins: ["https://lokerlombok.example"] });
    const allowed = await app.request("/jobs", { headers: { Origin: "https://lokerlombok.example" } });
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://lokerlombok.example");
    expect(allowed.headers.get("Vary")).toContain("Origin");

    const other = await app.request("/jobs", { headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
