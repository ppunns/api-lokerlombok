import { createApp } from "./app";
import { config } from "./config";
import { connectDb, POOL_MAX } from "./db";
import { createJobsRepository } from "./jobs/repository";

const sql = connectDb(config.DATABASE_URL, POOL_MAX.api);
const app = createApp({
  jobs: createJobsRepository(sql),
  pingDb: () => sql`select 1`,
  corsOrigins: config.CORS_ORIGINS,
});

export default {
  port: config.PORT,
  fetch: app.fetch,
};
