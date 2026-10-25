import { SQL } from "bun";

// Database integration tests truncate tables, so they only run against a local database.
export const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

export function connectLocalTestDb(): SQL {
  const host = new URL(testDatabaseUrl!).hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    throw new Error("TEST_DATABASE_URL must point to a local database");
  }
  return new SQL(testDatabaseUrl!);
}
