import { Hono } from "hono";
import type { JobsRepository } from "./jobs/repository";
import { jobsRoutes } from "./jobs/routes";

export function createApp(deps: { jobs: JobsRepository }) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/jobs", jobsRoutes(deps.jobs));

  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.onError((err, c) => {
    console.error(err.message);
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}
