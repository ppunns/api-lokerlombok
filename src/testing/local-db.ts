import { SQL } from "bun";

// Database integration tests truncate tables, so they only run against a local database.
export const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

// `user` connects as another role of the same local database (trust auth), e.g. api_readonly.
export function connectLocalTestDb(user?: string): SQL {
  const url = new URL(testDatabaseUrl!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("TEST_DATABASE_URL must point to a local database");
  }
  if (user) {
    url.username = user;
    url.password = "";
  }
  return new SQL(url.toString());
}
