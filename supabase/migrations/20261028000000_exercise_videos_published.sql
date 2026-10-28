-- Iron Log: explicit "published" visibility flag for the workout video catalog.
--
-- WHY
--   Until now a signed-in user could read a row only when review_status = 'matched' AND status = 'uploaded'.
--   That ties "may users see this video?" to "is it mapped to an exercise key?", so a video library that is
--   searched by title (most videos are unmatched or need review) would be almost entirely invisible.
--   review_status keeps its meaning (the state of the exercise-key mapping review). Visibility becomes its own,
--   deliberate decision: published = true.
--
-- NEW RULE (table and storage)
--   A signed-in user can read a row / sign its object only when  status = 'uploaded' AND published = true.
--   anon sees nothing. No INSERT/UPDATE/DELETE policy or privilege exists for anon or authenticated.
--   Only the service role / SQL editor can change `published`, and the ingest script never sets it: new rows
--   always start at published = false (the column default). Publishing is the separate, reviewed step in
--   supabase/manual/publish_videos.sql.
--
-- EXISTING ROWS
--   Rows that were already visible under the old rule (status = 'uploaded' AND review_status = 'matched', i.e.
--   the ones the posture modal plays) are backfilled to published = true ONCE, when the column is first
--   created, so nothing that worked yesterday disappears. Every other existing row stays unpublished.
--   Re-running this migration never republishes anything: the backfill only runs when the column is added.
--
-- INTEGRITY
--   A CHECK constraint makes it impossible to publish a row that is not 'uploaded' (pending or failed rows can
--   never be visible, even by mistake).
--
-- IDEMPOTENT: safe to run twice.
--
-- ROLLBACK (manual, in this order; run only if you need to return to the old rule):
--   drop policy if exists "exercise_videos_objects_read_published" on storage.objects;
--   create policy "exercise_videos_objects_read_published" on storage.objects for select to authenticated
--     using (bucket_id = 'exercise-videos' and exists (select 1 from public.exercise_videos v
--            where v.storage_key = storage.objects.name and v.status = 'uploaded' and v.review_status = 'matched'));
--   drop policy if exists "exercise_videos_select_published" on public.exercise_videos;
--   create policy "exercise_videos_select_published" on public.exercise_videos for select to authenticated
--     using (status = 'uploaded' and review_status = 'matched');
--   drop index if exists public.exercise_videos_library_idx;
--   alter table public.exercise_videos drop constraint if exists exercise_videos_published_requires_uploaded;
--   alter table public.exercise_videos drop column if exists published;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'exercise_videos' and column_name = 'published'
  ) then
    alter table public.exercise_videos add column published boolean not null default false;
    -- One-time carry-over of what users could already see under the previous rule.
    update public.exercise_videos set published = true where status = 'uploaded' and review_status = 'matched';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.exercise_videos'::regclass and conname = 'exercise_videos_published_requires_uploaded'
  ) then
    alter table public.exercise_videos
      add constraint exercise_videos_published_requires_uploaded check (not published or status = 'uploaded');
  end if;
end
$$;

comment on column public.exercise_videos.published is 'Visible to signed-in users only when true AND status = ''uploaded''. Default false. Set only by the reviewed publish step (supabase/manual/publish_videos.sql), never by ingestion.';

-- Serves the library screen: published videos in (title, id) order, which is also the keyset pagination order.
create index if not exists exercise_videos_library_idx
  on public.exercise_videos (title, id)
  where status = 'uploaded' and published;

-- Table policy: same name as before, new condition. review_status is no longer part of visibility.
drop policy if exists "exercise_videos_select_published" on public.exercise_videos;
create policy "exercise_videos_select_published"
  on public.exercise_videos for select
  to authenticated
  using (status = 'uploaded' and published = true);

-- Storage policy: a signed URL can be created only for an object backed by a published, uploaded catalog row.
drop policy if exists "exercise_videos_objects_read_published" on storage.objects;
create policy "exercise_videos_objects_read_published"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'exercise-videos'
    and exists (
      select 1
      from public.exercise_videos v
      where v.storage_key = storage.objects.name
        and v.status = 'uploaded'
        and v.published = true
    )
  );
