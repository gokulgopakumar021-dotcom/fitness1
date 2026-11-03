-- IL-04 hardening for public.consume_ai_quota (DRAFT: written in remediation session 2, NOT applied to any database).
-- Follows 20261031000000_ai_usage_quota.sql, which stays unchanged.
--
-- Problem: any signed-in user can call consume_ai_quota directly (PostgREST /rest/v1/rpc) with an arbitrary
-- p_bucket text (1..64 chars), and every new name creates a new counter row. Nothing ever deletes old rows.
-- A user could therefore create unbounded rows (storage growth) and the table would grow forever even for honest use.
--
-- Fix, in three parts:
--   1. Allow-list: only the AI buckets the server actually uses (the `ai: true` entries of ENDPOINTS in
--      src/server/security/endpoints.ts) are accepted. Anything else raises 22023. A test
--      (src/test/rls.aiUsageQuotaAllowlist.test.ts) fails if this list and endpoints.ts drift apart, so adding an AI
--      route means adding its bucket here in a NEW migration.
--   2. Bounded growth: with 15 buckets and 7 days kept, one user can hold at most 15 x 8 = 120 rows.
--   3. Housekeeping without pg_cron: the first time a user uses a bucket on a new UTC day (used = 1 after the
--      increment), that user's counters older than 7 days are deleted. It touches only the caller's own rows, is
--      served by the primary key (user_id, ...), and needs no extension, schedule or service role. Rows of users who
--      never return stay (bounded by the per-user cap above) and disappear with the account (ON DELETE CASCADE).
--
-- Unchanged on purpose: SECURITY DEFINER, empty search_path, UTC day computed inside the function, the atomic
-- INSERT .. ON CONFLICT DO UPDATE .. WHERE increment, argument validation, and the grants (authenticated only).
-- p_limit is still caller-supplied: a direct caller can only raise or exhaust THEIR OWN counters.

-- One-time cleanup of rows the new rules would not allow to exist. The live project had 0 rows when this was drafted
-- (read-only check, 2026-11-03), so this is a no-op there; it is kept for other environments.
delete from public.ai_usage_counters
where day < (now() at time zone 'utc')::date - 7
   or bucket <> all (array[
     'extract-plan', 'generate-plan', 'exercise-coach', 'generate-ai-routine', 'ai-food-parser',
     'ai-workout-insights', 'ai-plan-overload-tuning', 'ai-nutrition-coach', 'ai-recovery-insights',
     'ai-personal-trainer', 'adaptive-coach-explain', 'ai-form-analyzer', 'ai-warmup-generator',
     'ai-generate-physique', 'ai-physique-analysis'
   ]);

create or replace function public.consume_ai_quota(p_bucket text, p_limit integer)
returns table (allowed boolean, used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_day     date := (now() at time zone 'utc')::date;
  v_used    integer;
  v_keep    constant integer := 7;  -- days of counters kept per user
  -- Keep in sync with the `ai: true` buckets in src/server/security/endpoints.ts (enforced by a test).
  v_allowed constant text[] := array[
    'extract-plan', 'generate-plan', 'exercise-coach', 'generate-ai-routine', 'ai-food-parser',
    'ai-workout-insights', 'ai-plan-overload-tuning', 'ai-nutrition-coach', 'ai-recovery-insights',
    'ai-personal-trainer', 'adaptive-coach-explain', 'ai-form-analyzer', 'ai-warmup-generator',
    'ai-generate-physique', 'ai-physique-analysis'
  ];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_bucket is null or char_length(p_bucket) not between 1 and 64 or p_limit is null or p_limit < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if not (p_bucket = any (v_allowed)) then
    raise exception 'unknown bucket' using errcode = '22023';
  end if;
  if p_limit = 0 then
    return query select false, 0;
    return;
  end if;

  -- Atomic check-and-increment (unchanged): the row lock taken by ON CONFLICT DO UPDATE serialises concurrent
  -- callers, and the WHERE clause stops the increment once the limit is reached (RETURNING is then empty).
  insert into public.ai_usage_counters as c (user_id, bucket, day, used)
  values (v_user, p_bucket, v_day, 1)
  on conflict (user_id, bucket, day) do update
    set used = c.used + 1
    where c.used < p_limit
  returning c.used into v_used;

  if v_used is null then
    select c.used into v_used from public.ai_usage_counters c
      where c.user_id = v_user and c.bucket = p_bucket and c.day = v_day;
    return query select false, coalesce(v_used, 0);
  else
    if v_used = 1 then
      -- First use of this bucket today: drop this caller's counters older than the retention window.
      delete from public.ai_usage_counters c
        where c.user_id = v_user and c.day < v_day - v_keep;
    end if;
    return query select true, v_used;
  end if;
end;
$$;

-- Re-stated so the intended privileges are explicit in this migration (create or replace keeps existing ones).
revoke all on function public.consume_ai_quota(text, integer) from public, anon;
grant execute on function public.consume_ai_quota(text, integer) to authenticated;
