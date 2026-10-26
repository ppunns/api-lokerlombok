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

test("pool budget fits the pooler and the api_readonly limit during a deploy overlap", () => {
  const apiInstancesDuringDeploy = 2;
  const oneCliScript = POOL_MAX.worker;
  expect(apiInstancesDuringDeploy * POOL_MAX.api + POOL_MAX.worker + oneCliScript).toBeLessThanOrEqual(15);
  // connection limit 5 in supabase/migrations/20261027000000_create_api_readonly_role.sql
  expect(apiInstancesDuringDeploy * POOL_MAX.api).toBeLessThanOrEqual(5);
});
