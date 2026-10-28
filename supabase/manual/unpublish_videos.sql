-- Iron Log: UNPUBLISH videos (hide them from the Video Library again). YOU run this by hand in the SQL Editor.
-- Takes effect immediately for the table and for new signed URLs. A signed URL a user already holds keeps
-- working until it expires (1 hour). The row and the stored file are not deleted.

update public.exercise_videos set published = false
where content_sha256 = any (array[
  '0000000000000000000000000000000000000000000000000000000000000000'   -- REPLACE with the hashes to hide
]);

select count(*) filter (where published) as published, count(*) as total from public.exercise_videos where status = 'uploaded';
