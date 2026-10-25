import { Hono } from "hono";
import { cors } from "hono/cors";
import type { JobsRepository } from "./jobs/repository";
import { jobsRoutes } from "./jobs/routes";

export function createApp(deps: { jobs: JobsRepository; corsOrigins?: string[] }) {
  const app = new Hono();

  // Public read-only API: only GET is allowed cross-origin, without credentials.
  app.use("*", cors({ origin: deps.corsOrigins ?? "*", allowMethods: ["GET"], maxAge: 86400 }));

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/jobs", jobsRoutes(deps.jobs));

  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.onError((err, c) => {
    console.error(err.message);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}
