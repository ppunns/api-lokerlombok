-- Jobs collected from Instagram posts.
-- Enum values must stay in sync with src/schemas/job.ts.

create table public.jobs (
  id uuid primary key default gen_random_uuid(),

  title text not null check (btrim(title) <> ''),
  company_name text,
  location text,
  description text,
  requirements text[],
  employment_type text check (employment_type in ('full_time', 'part_time', 'contract', 'internship', 'freelance')),
  education_level text check (education_level in ('sd', 'smp', 'sma_smk', 'd1', 'd2', 'd3', 'd4', 's1', 's2', 's3')),
  salary_min bigint check (salary_min >= 0),
  salary_max bigint check (salary_max >= 0),
  salary_text text,
  deadline date,

  source_platform text not null default 'instagram' check (source_platform in ('instagram')),
  source_account text not null,
  source_post_url text not null,
  source_post_id text not null,
  source_job_index smallint not null default 0 check (source_job_index >= 0),
  source_posted_at timestamptz,
  raw_caption text,
  ocr_text text,

  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'extracted', 'failed')),
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published', 'rejected', 'expired')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint jobs_salary_range check (salary_min is null or salary_max is null or salary_min <= salary_max),
  -- One post may contain several jobs; each is identified by its index within the post.
  constraint jobs_source_job_unique unique (source_platform, source_post_id, source_job_index)
);

create index jobs_published_posted_at_idx on public.jobs (source_posted_at desc)
  where publication_status = 'published';
create index jobs_deadline_idx on public.jobs (deadline);

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- Public visitors may only read published jobs. Writes go through the backend
-- using the service-role key, which bypasses RLS.
alter table public.jobs enable row level security;

create policy "Published jobs are readable by everyone"
  on public.jobs for select
  to anon, authenticated
  using (publication_status = 'published');
