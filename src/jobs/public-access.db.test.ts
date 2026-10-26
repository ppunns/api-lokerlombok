// Integration tests against a local Postgres with migrations applied; see README "Testing".
// The local test setup grants anon/authenticated like Supabase does by default, so this proves the
// migration revokes them.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { connectLocalTestDb, testDatabaseUrl } from "../testing/local-db";

describe.skipIf(!testDatabaseUrl)("Supabase public roles (database)", () => {
  let sql: SQL;
  beforeAll(() => {
    sql = connectLocalTestDb();
  });
  afterAll(async () => {
    await sql?.close();
  });

  test.each(["anon", "authenticated"])("%s has no privileges on jobs or source_posts", async (role) => {
    const rows = await sql`
      select t.name, p.privilege, has_table_privilege(${role}, t.name, p.privilege) as granted
      from unnest(array['public.jobs', 'public.source_posts']) as t(name),
           unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(privilege)
    `;
    expect(rows.filter((r: { granted: boolean }) => r.granted)).toEqual([]);
  });

  test("only the api_readonly policy is left on jobs", async () => {
    const policies = await sql`select policyname from pg_policies where schemaname = 'public' and tablename = 'jobs'`;
    expect(policies.map((p: { policyname: string }) => p.policyname)).toEqual(["API reads published jobs"]);
  });
});
