import { expect, test } from "bun:test";
import { connectDb, POOL_MAX } from "./db";

test("connectDb caps the pool and releases idle connections", async () => {
  // Creating the client does not connect yet.
  const sql = connectDb("postgres://user:pw@localhost:5432/db", POOL_MAX.worker);
  expect(sql.options.max).toBe(2);
  expect(sql.options.idleTimeout).toBeGreaterThan(0);
  expect(sql.options.connectionTimeout).toBeGreaterThan(0);
  await sql.close();
});

test("pool budget stays below the Supabase session pooler size", () => {
  const oneCliScript = POOL_MAX.worker;
  expect(POOL_MAX.api + POOL_MAX.worker + oneCliScript).toBeLessThanOrEqual(15);
});
