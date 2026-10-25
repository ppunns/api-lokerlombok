import { SQL } from "bun";
import { createApp } from "./app";
import { config } from "./config";
import { createJobsRepository } from "./jobs/repository";

const sql = new SQL(config.DATABASE_URL);
const app = createApp({ jobs: createJobsRepository(sql), corsOrigins: config.CORS_ORIGINS });

export default {
  port: config.PORT,
  fetch: app.fetch,
};
