import { Hono } from "hono";
import { z } from "zod";
import { jobSearchQuerySchema } from "../schemas/job";
import type { JobsRepository } from "./repository";

export function jobsRoutes(repo: JobsRepository) {
  const router = new Hono();

  router.get("/", async (c) => {
    const parsed = jobSearchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "Invalid query", details: z.flattenError(parsed.error).fieldErrors }, 400);
    }

    const { page, limit } = parsed.data;
    const { jobs, total } = await repo.search(parsed.data);
    return c.json({
      data: jobs,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
  });

  router.get("/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Invalid job id" }, 400);

    const job = await repo.findPublishedById(id.data);
    if (!job) return c.json({ error: "Job not found" }, 404);
    return c.json({ data: job });
  });

  return router;
}
