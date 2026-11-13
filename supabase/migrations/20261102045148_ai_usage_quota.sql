-- Per-user daily AI usage counters (SEC-02). Applied to the live project on 2026-11-02 (recorded there as migration
-- `ai_usage_quota`, version 20261102045148). Comment-only edit; the SQL below is unchanged.
-- The server calls consume_ai_quota with the caller's own JWT (no service-role key on the server).
-- The UTC day is computed inside the function so a caller cannot choose which day's counter to touch.
-- A user who calls the function directly can only increment their OWN counters (i.e. lock themselves out earlier).
--
-- Housekeeping (not automated here): rows older than ~7 days can be deleted, e.g.
--   delete from public.ai_usage_counters where day < (now() at time zone 'utc')::date - 7;

create table if not exists public.ai_usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket  text not null check (char_length(bucket) between 1 and 64),
  day     date not null,
  used    integer not null default 0 check (used >= 0),
  primary key (user_id, bucket, day)
);

alter table public.ai_usage_counters enable row level security;
-- No policies: clients cannot read or write the table directly. Only the SECURITY DEFINER function below touches it.
revoke all on public.ai_usage_counters from public, anon, authenticated;

create or replace function public.consume_ai_quota(p_bucket text, p_limit integer)
returns table (allowed boolean, used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_day  date := (now() at time zone 'utc')::date;
  v_used integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_bucket is null or char_length(p_bucket) not between 1 and 64 or p_limit is null or p_limit < 0 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  if p_limit = 0 then
    return query select false, 0;
    return;
  end if;

  -- Atomic check-and-increment: the row lock taken by ON CONFLICT DO UPDATE serialises concurrent callers, and the
  -- WHERE clause stops the increment once the limit is reached (RETURNING is then empty).
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
    return query select true, v_used;
  end if;
end;
$$;

revoke all on function public.consume_ai_quota(text, integer) from public, anon;
grant execute on function public.consume_ai_quota(text, integer) to authenticated;
