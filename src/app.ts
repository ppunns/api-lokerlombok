import { Hono } from "hono";
import { cors } from "hono/cors";
import type { JobsRepository } from "./jobs/repository";
import { jobsRoutes } from "./jobs/routes";

export interface AppDeps {
  jobs: JobsRepository;
  // Resolves when the database answers; used by /health.
  pingDb: () => Promise<unknown>;
  corsOrigins?: string[];
  healthTimeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: Timer | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  // Public read-only API: only GET is allowed cross-origin, without credentials.
  app.use("*", cors({ origin: deps.corsOrigins ?? "*", allowMethods: ["GET"], maxAge: 86400 }));

  app.get("/health", async (c) => {
    try {
      await withTimeout(deps.pingDb(), deps.healthTimeoutMs ?? 2000);
      return c.json({ status: "ok" });
    } catch (err) {
      console.error(`health: database unavailable: ${err instanceof Error ? err.message : err}`);
      return c.json({ status: "unavailable" }, 503);
    }
  });
  app.route("/jobs", jobsRoutes(deps.jobs));

  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.onError((err, c) => {
    console.error(err.message);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}
