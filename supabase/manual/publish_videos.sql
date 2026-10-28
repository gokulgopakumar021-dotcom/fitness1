-- Iron Log: PUBLISH a batch of videos (make them visible in the Video Library). YOU run this by hand.
--
-- Where: Supabase Dashboard -> SQL Editor (runs as an admin role; the browser can never do this).
-- This file is NOT a migration and is never applied automatically. Review it, paste your hashes, run it.
--
-- What it does: sets published = true for exactly the SHA-256 hashes you list, in ONE all-or-nothing step.
-- It refuses (and changes nothing) when any hash is malformed, unknown, or not status = 'uploaded', so a pending
-- or failed upload can never be published. Already-published rows are left alone. It never touches review_status,
-- exercise_key or any other column.
--
-- Hashes: the content_sha256 values from your inventory (.video-library/manifest.jsonl / sample.txt), lowercase hex.
-- Replace the example list below with your own, one quoted hash per line, comma-separated.

do $$
declare
  batch   text[] := array[
    '0000000000000000000000000000000000000000000000000000000000000000',   -- REPLACE with your hashes
    '1111111111111111111111111111111111111111111111111111111111111111'
  ];
  malformed int;
  blocked   int;
  changed   int;
begin
  select count(*) into malformed from unnest(batch) as b(sha) where b.sha !~ '^[0-9a-f]{64}$';
  if malformed > 0 then
    raise exception 'Nothing published: % hash(es) are not 64 lowercase hex characters.', malformed;
  end if;

  select count(*) into blocked
  from unnest(batch) as b(sha)
  left join public.exercise_videos v on v.content_sha256 = b.sha
  where v.id is null or v.status <> 'uploaded';
  if blocked > 0 then
    raise exception 'Nothing published: % hash(es) are unknown or not status=uploaded.', blocked;
  end if;

  update public.exercise_videos set published = true
  where content_sha256 = any (batch) and published = false;
  get diagnostics changed = row_count;
  raise notice 'Published % new row(s); % hash(es) were listed.', changed, cardinality(batch);
end
$$;

-- Check the result (run after the block above):
select count(*) filter (where published) as published, count(*) filter (where not published) as unpublished, count(*) as total
from public.exercise_videos where status = 'uploaded';
