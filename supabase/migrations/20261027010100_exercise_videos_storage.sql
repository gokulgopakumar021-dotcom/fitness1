-- Iron Log: private Storage bucket for workout videos.
--
-- The bucket is PRIVATE (public = false): there is no public URL. Playback uses short-lived signed URLs, and
-- Supabase checks the policy below when a signed URL is created. A signed-in user may sign only objects that
-- are referenced by a published catalog row, so pending, unreviewed or failed uploads are never reachable
-- from the browser. No INSERT/UPDATE/DELETE policy exists for anon or authenticated: uploads happen only
-- through the service role in the offline ingestion script.
--
-- Creating this bucket stores nothing and costs nothing by itself; storage and egress are billed only once
-- files exist and are played. Idempotent: safe to run twice.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-videos', 'exercise-videos', false, 104857600, array['video/mp4'])  -- 100 MiB per file, MP4 only
on conflict (id) do nothing;

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
        and v.review_status = 'matched'
    )
  );
