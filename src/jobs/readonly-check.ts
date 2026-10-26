import type { SQL } from "bun";

export interface AccessCheck {
  name: string;
  ok: boolean;
  detail: string;
}

class Rollback extends Error {}
const DENIED = /permission denied/i;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Verifies that a connection behaves as the read-only API role (migration create_api_readonly_role).
// Write attempts match no rows and run in a transaction that is always rolled back,
// so nothing changes even when the connection turns out to be writable.
export async function checkReadOnlyAccess(sql: SQL): Promise<AccessCheck[]> {
  const checks: AccessCheck[] = [];

  const allowed = async (name: string, run: () => Promise<{ ok: boolean; detail: string }>) => {
    try {
      checks.push({ name, ...(await run()) });
    } catch (err) {
      checks.push({ name, ok: false, detail: message(err) });
    }
  };
  const denied = async (name: string, run: (tx: SQL) => Promise<unknown>) => {
    try {
      await sql.begin(async (tx) => {
        await run(tx);
        throw new Rollback();
      });
      checks.push({ name, ok: false, detail: "unexpectedly allowed" });
    } catch (err) {
      if (err instanceof Rollback) checks.push({ name, ok: false, detail: "unexpectedly allowed (rolled back)" });
      // Only a privilege error counts; anything else (e.g. a broken query) proves nothing.
      else checks.push({ name, ok: DENIED.test(message(err)), detail: message(err) });
    }
  };

  await allowed("connected as api_readonly, read-only by default", async () => {
    const [row] = await sql`select current_user as user, current_setting('transaction_read_only') as ro`;
    return { ok: row.user === "api_readonly" && row.ro === "on", detail: `user=${row.user} read_only=${row.ro}` };
  });
  await allowed("reads published jobs", async () => {
    const [row] = await sql`select count(*)::int as n from public.jobs where publication_status = 'published'`;
    return { ok: true, detail: `${row.n} published` };
  });
  await allowed("sees no unpublished jobs (RLS)", async () => {
    const [row] = await sql`select count(*)::int as n from public.jobs where publication_status <> 'published'`;
    return { ok: row.n === 0, detail: `${row.n} visible` };
  });
  // Read-only is only a default a client can switch off, so writes are tested in a read-write
  // transaction: they must still fail on missing privileges.
  const readWrite = async (tx: SQL, write: () => Promise<unknown>) => {
    await tx`set transaction read write`;
    return write();
  };
  await denied("cannot insert jobs, even read-write", (tx) => readWrite(tx, () => tx`
    insert into public.jobs (title, source_account, source_post_url, source_post_id)
    select 'readonly-check', 'readonly-check', 'https://example.invalid/', 'readonly-check' where false
  `));
  await denied("cannot update jobs, even read-write", (tx) => readWrite(tx, () => tx`update public.jobs set title = title where false`));
  await denied("cannot delete jobs, even read-write", (tx) => readWrite(tx, () => tx`delete from public.jobs where false`));
  await denied("cannot read source_posts", (tx) => tx`select 1 from public.source_posts limit 1`);

  return checks;
}
