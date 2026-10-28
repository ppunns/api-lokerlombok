-- Schedule for automatic collection, set from the admin menu (scripts/schedule.ts).
-- The pipeline is triggered often (Cloud Scheduler, every 15 minutes) and collects only when one of
-- run_times (WITA) has passed since last_collected_at. Without a row, the pipeline collects on every
-- trigger using IG_TARGET_USERNAME and AUTO_PUBLISH, as before.

create table public.pipeline_schedule (
  -- Single row.
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  account text not null check (account ~ '^[A-Za-z0-9._]{1,30}$'),
  -- "HH:MM" in WITA (Asia/Makassar), e.g. {07:00,19:00}.
  run_times text[] not null check (
    cardinality(run_times) between 1 and 24
    and array_to_string(run_times, ',') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$'
  ),
  auto_publish boolean not null default true,
  -- Written by the pipeline: start of the last successful scheduled collect.
  last_collected_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger pipeline_schedule_set_updated_at
  before update on public.pipeline_schedule
  for each row execute function public.set_updated_at();

-- Internal table: only the backend (postgres) uses it. Supabase grants new tables to anon/authenticated
-- by default, so revoke that and keep RLS on without policies, like source_posts.
revoke all on table public.pipeline_schedule from anon, authenticated;
alter table public.pipeline_schedule enable row level security;
