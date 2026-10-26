-- Read-only login role for the public API (src/index.ts via API_DATABASE_URL).
-- The pipeline and admin scripts keep using DATABASE_URL.
-- No password here: set it once in the SQL editor (alter role api_readonly password '...')
-- and keep it only in the API's environment.

create role api_readonly login noinherit connection limit 5; -- matches POOL_MAX.api in src/db.ts
alter role api_readonly set default_transaction_read_only = on;
alter role api_readonly set statement_timeout = '5s';

grant usage on schema public to api_readonly;
-- Only jobs; source_posts stays inaccessible.
grant select on public.jobs to api_readonly;

-- RLS also applies to this role, so even a buggy query only sees published jobs.
create policy "API reads published jobs"
  on public.jobs for select
  to api_readonly
  using (publication_status = 'published');
