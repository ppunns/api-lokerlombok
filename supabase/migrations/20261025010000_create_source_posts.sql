-- Instagram posts fetched by the collector (src/collector), before and after job extraction.

create table public.source_posts (
  id uuid primary key default gen_random_uuid(),

  source_platform text not null default 'instagram' check (source_platform in ('instagram')),
  source_account text not null,
  -- Instagram media id from the API; jobs.source_post_id uses the same value.
  source_post_id text not null,
  source_post_url text not null,
  source_posted_at timestamptz not null,
  media_type text not null check (media_type in ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM')),
  caption text,
  -- Temporary Instagram CDN URLs for OCR; they expire and are not copies of the images.
  media_urls text[] not null default '{}',

  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processed', 'no_jobs', 'failed')),
  processing_error text,
  processing_attempts integer not null default 0 check (processing_attempts >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint source_posts_source_unique unique (source_platform, source_post_id)
);

create index source_posts_pending_idx on public.source_posts (source_posted_at)
  where processing_status in ('pending', 'failed');

create trigger source_posts_set_updated_at
  before update on public.source_posts
  for each row execute function public.set_updated_at();

-- Internal table: RLS on with no policies, so only the backend (service role / postgres) can access it.
alter table public.source_posts enable row level security;
