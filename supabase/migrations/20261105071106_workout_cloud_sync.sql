-- Iron Log: cross-device workout sync schema.
--
-- This file records, in the repository, the migration `workout_cloud_sync` that is ALREADY APPLIED to the live
-- project (version 20261105071106). It was reconstructed from the live catalog (tables, constraints, policies,
-- triggers, functions, grants) and is idempotent, so applying it again to the live database changes nothing.
--
-- Model: localStorage stays the working copy; these tables are the cloud copy. One row per record, keyed by
-- (user_id, id) where `id` is the app's own stable record id. `data` holds the record as JSON. Deletes are
-- tombstones (deleted_at), never row removal, so a deleted record cannot reappear from a stale device.
-- `version` is bumped by the row guard on every change and is the optimistic-concurrency token used by
-- push_workout_record(). Everything is scoped to auth.uid() by RLS; the RPCs are SECURITY INVOKER so RLS applies.
-- Rows are removed with the account through ON DELETE CASCADE (delete_own_account()).

create table if not exists public.workout_plans (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                text        not null,
  data              jsonb       not null default '{}'::jsonb,
  client_updated_at timestamptz not null default now(),
  version           bigint      not null default 1,
  deleted_at        timestamptz,
  device_id         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default clock_timestamp(),
  primary key (user_id, id),
  constraint workout_plans_id_length check (char_length(id) >= 1 and char_length(id) <= 128),
  constraint workout_plans_data_object check (jsonb_typeof(data) = 'object'),
  constraint workout_plans_data_size check (pg_column_size(data) <= 1048576),
  constraint workout_plans_device_length check (device_id is null or char_length(device_id) <= 64)
);
comment on table public.workout_plans is 'A saved workout plan (template). One row per plan id. Cloud copy for cross-device sync; localStorage remains the working copy.';
create index if not exists workout_plans_user_updated_idx on public.workout_plans (user_id, updated_at, id);

create table if not exists public.workout_sessions (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                text        not null,
  data              jsonb       not null default '{}'::jsonb,
  client_updated_at timestamptz not null default now(),
  version           bigint      not null default 1,
  deleted_at        timestamptz,
  device_id         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default clock_timestamp(),
  session_date      text generated always as (
                      case when (data ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then data ->> 'date' else null end) stored,
  status            text generated always as (data ->> 'status') stored,
  plan_id           text generated always as (data ->> 'planId') stored,
  primary key (user_id, id),
  constraint workout_sessions_id_length check (char_length(id) >= 1 and char_length(id) <= 128),
  constraint workout_sessions_data_object check (jsonb_typeof(data) = 'object'),
  constraint workout_sessions_data_size check (pg_column_size(data) <= 1048576),
  constraint workout_sessions_device_length check (device_id is null or char_length(device_id) <= 64)
);
comment on table public.workout_sessions is 'A workout session record (completed / abandoned history). One row per session id. Cloud copy for cross-device sync; localStorage remains the working copy.';
create index if not exists workout_sessions_user_updated_idx on public.workout_sessions (user_id, updated_at, id);

create table if not exists public.workout_active_sessions (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                text        not null,
  data              jsonb       not null default '{}'::jsonb,
  client_updated_at timestamptz not null default now(),
  version           bigint      not null default 1,
  deleted_at        timestamptz,
  device_id         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default clock_timestamp(),
  primary key (user_id, id),
  constraint workout_active_sessions_id_length check (char_length(id) >= 1 and char_length(id) <= 128),
  constraint workout_active_sessions_data_object check (jsonb_typeof(data) = 'object'),
  constraint workout_active_sessions_data_size check (pg_column_size(data) <= 1048576),
  constraint workout_active_sessions_device_length check (device_id is null or char_length(device_id) <= 64)
);
comment on table public.workout_active_sessions is 'An in-progress workout session so it can be resumed on another device. One row per session id. Cloud copy for cross-device sync; localStorage remains the working copy.';
create index if not exists workout_active_sessions_user_updated_idx on public.workout_active_sessions (user_id, updated_at, id);

create table if not exists public.workout_prefs (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                text        not null,
  data              jsonb       not null default '{}'::jsonb,
  client_updated_at timestamptz not null default now(),
  version           bigint      not null default 1,
  deleted_at        timestamptz,
  device_id         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default clock_timestamp(),
  primary key (user_id, id),
  constraint workout_prefs_id_length check (char_length(id) >= 1 and char_length(id) <= 128),
  constraint workout_prefs_data_object check (jsonb_typeof(data) = 'object'),
  constraint workout_prefs_data_size check (pg_column_size(data) <= 1048576),
  constraint workout_prefs_device_length check (device_id is null or char_length(device_id) <= 64)
);
comment on table public.workout_prefs is 'Small per-account workout settings (currently the active plan id). One row per setting id. Cloud copy for cross-device sync; localStorage remains the working copy.';
create index if not exists workout_prefs_user_updated_idx on public.workout_prefs (user_id, updated_at, id);
create index if not exists workout_sessions_user_date_idx
  on public.workout_sessions (user_id, session_date desc) where deleted_at is null;

-- Row guard: identity is immutable, version/created_at/updated_at are server-controlled, and a device clock far in
-- the future cannot win conflicts forever. Not callable through the API.
create or replace function public.workout_sync_row_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
  else
    if new.user_id is distinct from old.user_id or new.id is distinct from old.id then
      raise exception 'workout record identity is immutable' using errcode = '42501';
    end if;
    new.version := old.version + 1;
    new.created_at := old.created_at;
  end if;
  new.updated_at := clock_timestamp();
  if new.client_updated_at > now() + interval '1 day' then
    new.client_updated_at := now();   -- a wrong device clock must not win conflicts forever
  end if;
  return new;
end;
$$;
revoke all on function public.workout_sync_row_guard() from public, anon, authenticated;

drop trigger if exists workout_plans_row_guard on public.workout_plans;
create trigger workout_plans_row_guard
  before insert or update on public.workout_plans
  for each row execute function public.workout_sync_row_guard();

alter table public.workout_plans enable row level security;
revoke all on public.workout_plans from anon, authenticated;
grant select, insert, update, delete on public.workout_plans to authenticated;

drop policy if exists "workout_plans_select_own" on public.workout_plans;
create policy "workout_plans_select_own" on public.workout_plans for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "workout_plans_insert_own" on public.workout_plans;
create policy "workout_plans_insert_own" on public.workout_plans for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "workout_plans_update_own" on public.workout_plans;
create policy "workout_plans_update_own" on public.workout_plans for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "workout_plans_delete_own" on public.workout_plans;
create policy "workout_plans_delete_own" on public.workout_plans for delete to authenticated
  using ((select auth.uid()) = user_id);

drop trigger if exists workout_sessions_row_guard on public.workout_sessions;
create trigger workout_sessions_row_guard
  before insert or update on public.workout_sessions
  for each row execute function public.workout_sync_row_guard();

alter table public.workout_sessions enable row level security;
revoke all on public.workout_sessions from anon, authenticated;
grant select, insert, update, delete on public.workout_sessions to authenticated;

drop policy if exists "workout_sessions_select_own" on public.workout_sessions;
create policy "workout_sessions_select_own" on public.workout_sessions for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "workout_sessions_insert_own" on public.workout_sessions;
create policy "workout_sessions_insert_own" on public.workout_sessions for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "workout_sessions_update_own" on public.workout_sessions;
create policy "workout_sessions_update_own" on public.workout_sessions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "workout_sessions_delete_own" on public.workout_sessions;
create policy "workout_sessions_delete_own" on public.workout_sessions for delete to authenticated
  using ((select auth.uid()) = user_id);

drop trigger if exists workout_active_sessions_row_guard on public.workout_active_sessions;
create trigger workout_active_sessions_row_guard
  before insert or update on public.workout_active_sessions
  for each row execute function public.workout_sync_row_guard();

alter table public.workout_active_sessions enable row level security;
revoke all on public.workout_active_sessions from anon, authenticated;
grant select, insert, update, delete on public.workout_active_sessions to authenticated;

drop policy if exists "workout_active_sessions_select_own" on public.workout_active_sessions;
create policy "workout_active_sessions_select_own" on public.workout_active_sessions for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "workout_active_sessions_insert_own" on public.workout_active_sessions;
create policy "workout_active_sessions_insert_own" on public.workout_active_sessions for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "workout_active_sessions_update_own" on public.workout_active_sessions;
create policy "workout_active_sessions_update_own" on public.workout_active_sessions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "workout_active_sessions_delete_own" on public.workout_active_sessions;
create policy "workout_active_sessions_delete_own" on public.workout_active_sessions for delete to authenticated
  using ((select auth.uid()) = user_id);

drop trigger if exists workout_prefs_row_guard on public.workout_prefs;
create trigger workout_prefs_row_guard
  before insert or update on public.workout_prefs
  for each row execute function public.workout_sync_row_guard();

alter table public.workout_prefs enable row level security;
revoke all on public.workout_prefs from anon, authenticated;
grant select, insert, update, delete on public.workout_prefs to authenticated;

drop policy if exists "workout_prefs_select_own" on public.workout_prefs;
create policy "workout_prefs_select_own" on public.workout_prefs for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "workout_prefs_insert_own" on public.workout_prefs;
create policy "workout_prefs_insert_own" on public.workout_prefs for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "workout_prefs_update_own" on public.workout_prefs;
create policy "workout_prefs_update_own" on public.workout_prefs for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "workout_prefs_delete_own" on public.workout_prefs;
create policy "workout_prefs_delete_own" on public.workout_prefs for delete to authenticated
  using ((select auth.uid()) = user_id);

-- pull_workout_changes: keyset-paginated change feed for the caller's own rows, ordered by (updated_at, kind, id).
create or replace function public.pull_workout_changes(
  p_after_ts timestamptz default null,
  p_after_kind text default null,
  p_after_id text default null,
  p_limit integer default 500)
returns table(kind text, id text, data jsonb, client_updated_at timestamptz, version bigint,
              deleted_at timestamptz, updated_at timestamptz, device_id text)
language sql
stable
set search_path to ''
as $function$
  select r.kind, r.id, r.data, r.client_updated_at, r.version, r.deleted_at, r.updated_at, r.device_id
  from (
    select 'plans'::text as kind, p.id, p.data, p.client_updated_at, p.version, p.deleted_at, p.updated_at, p.device_id
      from public.workout_plans p where p.user_id = (select auth.uid())
    union all
    select 'sessions', s.id, s.data, s.client_updated_at, s.version, s.deleted_at, s.updated_at, s.device_id
      from public.workout_sessions s where s.user_id = (select auth.uid())
    union all
    select 'active_sessions', a.id, a.data, a.client_updated_at, a.version, a.deleted_at, a.updated_at, a.device_id
      from public.workout_active_sessions a where a.user_id = (select auth.uid())
    union all
    select 'prefs', f.id, f.data, f.client_updated_at, f.version, f.deleted_at, f.updated_at, f.device_id
      from public.workout_prefs f where f.user_id = (select auth.uid())
  ) r
  where p_after_ts is null
     or (r.updated_at, r.kind, r.id) > (p_after_ts, coalesce(p_after_kind, ''), coalesce(p_after_id, ''))
  order by r.updated_at, r.kind, r.id
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$function$;

-- push_workout_record: optimistic-concurrency upsert/tombstone of ONE record owned by the caller.
-- outcome 'applied'  -> written (or an identical replay of an earlier push); returned row is the stored row.
-- outcome 'conflict' -> the stored version differs from p_base_version; nothing written, the stored row is returned
--                       so the client can merge. Idempotent: replaying a successful push never duplicates.
create or replace function public.push_workout_record(
  p_kind text, p_id text, p_data jsonb, p_client_updated_at timestamptz,
  p_base_version bigint, p_deleted boolean, p_device_id text)
returns table(outcome text, kind text, id text, data jsonb, client_updated_at timestamptz, version bigint,
              deleted_at timestamptz, updated_at timestamptz, device_id text)
language plpgsql
set search_path to ''
as $function$
declare
  v_uid     uuid := (select auth.uid());
  v_table   text;
  v_n       integer;
  v_data    jsonb;
  v_cua     timestamptz;
  v_version bigint;
  v_del     timestamptz;
  v_upd     timestamptz;
  v_dev     text;
  v_outcome text;
  v_data_in jsonb;
  v_cua_in  timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  v_table := case p_kind
    when 'plans' then 'workout_plans'
    when 'sessions' then 'workout_sessions'
    when 'active_sessions' then 'workout_active_sessions'
    when 'prefs' then 'workout_prefs'
  end;
  if v_table is null then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_id is null or char_length(p_id) not between 1 and 128
     or p_base_version is null or p_base_version < 0 or p_deleted is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  -- A tombstone carries no content (the deleted record's data is not kept).
  v_data_in := case when p_deleted then '{}'::jsonb else coalesce(p_data, '{}'::jsonb) end;
  v_cua_in  := least(coalesce(p_client_updated_at, now()), now() + interval '1 day');

  -- Lock the row (if any) so concurrent pushes of the same record are serialised.
  execute format(
    'select data, client_updated_at, version, deleted_at, updated_at, device_id from public.%I where user_id = $1 and id = $2 for update',
    v_table)
    into v_data, v_cua, v_version, v_del, v_upd, v_dev
    using v_uid, p_id;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    execute format(
      'insert into public.%I (user_id, id, data, client_updated_at, deleted_at, device_id) values ($1, $2, $3, $4, case when $5 then clock_timestamp() end, $6) returning data, client_updated_at, version, deleted_at, updated_at, device_id',
      v_table)
      into v_data, v_cua, v_version, v_del, v_upd, v_dev
      using v_uid, p_id, v_data_in, v_cua_in, p_deleted, p_device_id;
    v_outcome := 'applied';
  elsif v_version = p_base_version then
    execute format(
      'update public.%I set data = $3, client_updated_at = $4, deleted_at = case when $5 then coalesce(deleted_at, clock_timestamp()) end, device_id = $6 where user_id = $1 and id = $2 returning data, client_updated_at, version, deleted_at, updated_at, device_id',
      v_table)
      into v_data, v_cua, v_version, v_del, v_upd, v_dev
      using v_uid, p_id, v_data_in, v_cua_in, p_deleted, p_device_id;
    v_outcome := 'applied';
  elsif (v_del is not null) = p_deleted and (p_deleted or v_data = v_data_in) then
    v_outcome := 'applied';      -- identical replay of an earlier successful push: nothing to write
  else
    v_outcome := 'conflict';
  end if;

  return query select v_outcome, p_kind, p_id, v_data, v_cua, v_version, v_del, v_upd, v_dev;
end;
$function$;

revoke all on function public.pull_workout_changes(timestamptz, text, text, integer) from public, anon;
revoke all on function public.push_workout_record(text, text, jsonb, timestamptz, bigint, boolean, text) from public, anon;
grant execute on function public.pull_workout_changes(timestamptz, text, text, integer) to authenticated;
grant execute on function public.push_workout_record(text, text, jsonb, timestamptz, bigint, boolean, text) to authenticated;
