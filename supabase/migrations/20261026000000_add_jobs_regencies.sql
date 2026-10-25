-- Normalized kabupaten/kota (NTB) of a job's work location, for filtering.
-- `location` keeps the text as written. Values must stay in sync with src/schemas/job.ts.

alter table public.jobs
  add column regencies text[] not null default '{}'
    constraint jobs_regencies_check check (regencies <@ array[
      'kota_mataram', 'lombok_barat', 'lombok_tengah', 'lombok_timur', 'lombok_utara',
      'sumbawa_barat', 'sumbawa', 'dompu', 'bima', 'kota_bima'
    ]::text[]);

create index jobs_regencies_idx on public.jobs using gin (regencies);
