-- The frontend only talks to our API (role api_readonly), never to Supabase directly.
-- Supabase grants anon/authenticated full table privileges by default, guarded only by RLS, which
-- exposed published jobs (incl. raw_caption and ocr_text) through the Supabase REST API.
-- Remove that second public path entirely. The backend roles (postgres, api_readonly) are unaffected.

revoke all on table public.jobs from anon, authenticated;
revoke all on table public.source_posts from anon, authenticated;

drop policy "Published jobs are readable by everyone" on public.jobs;
