import { createApp } from "./app";
import { config } from "./config";
import { connectDb, POOL_MAX } from "./db";
import { createJobsRepository } from "./jobs/repository";

const sql = connectDb(config.apiDatabaseUrl, POOL_MAX.api);
const app = createApp({
  jobs: createJobsRepository(sql),
  pingDb: () => sql`select 1`,
  corsOrigins: config.CORS_ORIGINS,
});

const server = Bun.serve({ port: config.PORT, fetch: app.fetch });
console.log(`API listening on port ${server.port}`);

// Hosts send SIGTERM before replacing an instance: finish in-flight requests, then free the
// database connections so the new instance can use them.
process.once("SIGTERM", async () => {
  await server.stop();
  await sql.close({ timeout: 5 });
  process.exit(0);
});
