-- BT-04B PROPOSED migration. NOT applied. Requires explicit owner approval before it is applied to the live project.
-- Builds on 20261115131442_wearable_foundation (already applied; never edited). Additive and idempotent.
--
-- What it changes, and why:
--  1. Consent: two new categories (historical_heart_rate, workout_health_sync) + an append-only audit table.
--     Consent is changed ONLY through set_my_wearable_consent(); clients keep SELECT, lose direct write.
--  2. Ingestion: wearable_samples/wearable_devices INSERT is revoked from `authenticated`. The only write path is
--     ingest_wearable_batch(), which derives the owner from auth.uid(), requires workout_health_sync consent and
--     inserts idempotently. This closes the PostgREST bypass of the ingestion API (rate limits, validation, consent).
--  3. wearable_samples.workout_session_id: a plain label (no FK) because sessions are local-first and may not be
--     cloud-synced yet. It is only ever read together with user_id, so it cannot link across accounts.
--  3b. BT-04C: session verification. wearable_samples.workout_session_verified is set ONLY inside ingest_wearable_batch(), from the
--     caller's own cloud-synced workout_sessions / workout_active_sessions rows (never from request data):
--       true  = the session exists for this user and measured_at is inside its window (+/- 5 minutes of clock/BLE skew);
--       false = labelled but UNVERIFIED (session not cloud-synced yet, deleted, window not determinable, or not this user's);
--       null  = no session label.
--     A sample for a cloud-synced session whose measured_at is OUTSIDE its window is not stored (returned in rejected_keys).
--  4. Plausibility CHECK mirroring src/wearables/types.ts METRICS (NOT VALID: applies to new rows; a test guards drift).

-- 1. Consent -------------------------------------------------------------------------------------------------------
alter table public.wearable_ai_consents drop constraint if exists wearable_ai_consents_categories_check;
alter table public.wearable_ai_consents add constraint wearable_ai_consents_categories_check
  check (cardinality(categories) >= 1 and categories <@ array[
    'live_heart_rate','historical_heart_rate','workout_health_sync','sleep_and_recovery_metrics','activity_metrics']);

create table if not exists public.wearable_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in
    ('live_heart_rate','historical_heart_rate','workout_health_sync','sleep_and_recovery_metrics','activity_metrics')),
  action text not null check (action in ('granted','revoked')),
  consent_version integer not null check (consent_version >= 1),
  created_at timestamptz not null default now()
);
create index if not exists wearable_consent_events_user_time on public.wearable_consent_events (user_id, created_at desc);
alter table public.wearable_consent_events enable row level security;
revoke all on public.wearable_consent_events from public, anon, authenticated;
grant select on public.wearable_consent_events to authenticated;
drop policy if exists wearable_consent_events_select on public.wearable_consent_events;
create policy wearable_consent_events_select on public.wearable_consent_events for select to authenticated
  using (user_id = (select auth.uid()));

-- Consent state is now written only by the function below (so every change has an audit row in the same transaction).
revoke insert, update, delete on public.wearable_ai_consents from authenticated;
drop policy if exists wearable_ai_consents_own on public.wearable_ai_consents;
drop policy if exists wearable_ai_consents_select on public.wearable_ai_consents;
create policy wearable_ai_consents_select on public.wearable_ai_consents for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.set_my_wearable_consent(p_categories text[], p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_new text[];
  v_old text[];
  v_old_version integer;
  v_all constant text[] := array['live_heart_rate','historical_heart_rate','workout_health_sync','sleep_and_recovery_metrics','activity_metrics'];
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_version is null or p_version < 1 then raise exception 'invalid consent version' using errcode = '22023'; end if;
  v_new := coalesce(array(select distinct c from unnest(coalesce(p_categories, '{}'::text[])) as c order by c), '{}'::text[]);
  if not (v_new <@ v_all) then raise exception 'invalid consent category' using errcode = '22023'; end if;

  select categories, version into v_old, v_old_version from public.wearable_ai_consents where user_id = v_uid for update;
  -- A consent recorded under another version never counts, so re-consenting is a fresh grant of every category.
  if v_old is null or v_old_version is distinct from p_version then v_old := '{}'::text[]; end if;

  insert into public.wearable_consent_events (user_id, category, action, consent_version)
    select v_uid, c, 'granted', p_version from unnest(v_new) as c where not (c = any (v_old));
  insert into public.wearable_consent_events (user_id, category, action, consent_version)
    select v_uid, c, 'revoked', p_version from unnest(v_old) as c where not (c = any (v_new));

  if cardinality(v_new) = 0 then
    delete from public.wearable_ai_consents where user_id = v_uid;
  else
    insert into public.wearable_ai_consents (user_id, version, categories, granted_at) values (v_uid, p_version, v_new, now())
    on conflict (user_id) do update set version = excluded.version, categories = excluded.categories, granted_at = now();
  end if;
end $$;
revoke all on function public.set_my_wearable_consent(text[], integer) from public, anon;
grant execute on function public.set_my_wearable_consent(text[], integer) to authenticated;

-- 2/3. Ingestion ----------------------------------------------------------------------------------------------------
alter table public.wearable_samples add column if not exists workout_session_id text
  check (workout_session_id is null or char_length(workout_session_id) between 1 and 128);
create index if not exists wearable_samples_user_workout on public.wearable_samples (user_id, workout_session_id, measured_at)
  where workout_session_id is not null;

alter table public.wearable_samples drop constraint if exists wearable_samples_plausible;
alter table public.wearable_samples add constraint wearable_samples_plausible check (
     (metric = 'heart_rate' and value between 20 and 255)
  or (metric = 'resting_heart_rate' and value between 20 and 200)
  or (metric in ('hrv_rmssd','hrv_sdnn') and value between 0 and 400)
  or (metric = 'steps' and value between 0 and 200000)
  or (metric = 'active_energy' and value between 0 and 20000)
  or (metric = 'total_energy' and value between 0 and 30000)
  or (metric = 'distance' and value between 0 and 500000)
  or (metric in ('workout_duration','sleep_duration') and value between 1 and 86400)
  or (metric = 'blood_oxygen' and value between 50 and 100)
  or (metric = 'respiratory_rate' and value between 3 and 70)) not valid;

revoke insert on public.wearable_devices, public.wearable_samples from authenticated;
drop policy if exists wearable_devices_insert on public.wearable_devices;
drop policy if exists wearable_samples_insert on public.wearable_samples;

-- BT-04C: session verification label (see header). Server-set only; clients cannot insert.
alter table public.wearable_samples add column if not exists workout_session_verified boolean;
comment on column public.wearable_samples.workout_session_verified is
  'true: session exists for this user and measured_at falls inside it. false: labelled but unverified. null: no session label. Set only by ingest_wearable_batch().';

-- Safe timestamp parse for JSON written by clients (a bad value yields null, never an error that aborts the whole batch).
create or replace function public.wearable_try_timestamptz(p text)
returns timestamptz language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}T' then return null; end if;
  return p::timestamptz;
exception when others then
  return null;
end $$;
revoke all on function public.wearable_try_timestamptz(text) from public, anon, authenticated;

-- p_device: {device_key, manufacturer, model?, display_name?, ingestion_method}
-- p_samples: [{metric,value,unit,measured_at,measured_end_at?,tz_offset_min?,source_record_id?,origin,quality,dedupe_key,workout_session_id?}]
-- Returns {device_id, inserted_keys, verified_keys, rejected_keys}. verified_keys is a subset of inserted_keys. rejected_keys are samples
-- for a cloud-synced session whose measured_at is outside it (not stored). A key in none of them was a duplicate.
-- Simulated origin cannot pass the table CHECK.
create or replace function public.ingest_wearable_batch(p_device jsonb, p_samples jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_dev uuid;
  v_keys jsonb;
  v_verified jsonb;
  v_rejected jsonb;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(p_samples) is distinct from 'array' or jsonb_array_length(p_samples) > 500 then
    raise exception 'invalid batch' using errcode = '22023';
  end if;
  if not exists (select 1 from public.wearable_ai_consents where user_id = v_uid and 'workout_health_sync' = any (categories)) then
    raise exception 'consent_required' using errcode = 'P0001';
  end if;

  insert into public.wearable_devices (user_id, device_key, manufacturer, model, display_name, ingestion_method, last_seen_at)
  values (v_uid, p_device->>'device_key', p_device->>'manufacturer', nullif(p_device->>'model', ''),
          nullif(p_device->>'display_name', ''), p_device->>'ingestion_method', now())
  on conflict (user_id, ingestion_method, device_key)
  do update set last_seen_at = now(), model = coalesce(excluded.model, public.wearable_devices.model),
                display_name = coalesce(excluded.display_name, public.wearable_devices.display_name)
  returning id into v_dev;

  with input as (
    select s, ord, nullif(s->>'workout_session_id', '') as sid, (s->>'measured_at')::timestamptz as ts
    from jsonb_array_elements(p_samples) with ordinality as t(s, ord)),
  judged as (
    select i.*,
      case
        when i.sid is null then 'none'
        when w.found is not true then 'unverified'               -- not cloud-synced (yet), deleted, or not this user's
        when w.t_start is null or w.t_end is null then 'unverified' -- window cannot be determined
        when i.ts >= w.t_start - interval '5 minutes' and i.ts <= w.t_end + interval '5 minutes' then 'verified'
        else 'outside'
      end as verdict
    from input i
    left join lateral (
      select true as found,
             public.wearable_try_timestamptz(x.data->>'startTime') as t_start,
             case when x.data->>'status' = 'in_progress' then now() else public.wearable_try_timestamptz(x.data->>'endTime') end as t_end
      from (
        select data, 1 as pri from public.workout_sessions where user_id = v_uid and id = i.sid and deleted_at is null
        union all
        select data, 2 as pri from public.workout_active_sessions where user_id = v_uid and id = i.sid and deleted_at is null
        order by pri limit 1) x
    ) w on true),
  ins as (
    insert into public.wearable_samples (user_id, device_id, metric, value, unit, measured_at, measured_end_at, tz_offset_min,
      source_record_id, origin, quality, dedupe_key, workout_session_id, workout_session_verified)
    select v_uid, v_dev, j.s->>'metric', (j.s->>'value')::double precision, j.s->>'unit', j.ts,
      nullif(j.s->>'measured_end_at', '')::timestamptz, nullif(j.s->>'tz_offset_min', '')::smallint, nullif(j.s->>'source_record_id', ''),
      j.s->>'origin', j.s->>'quality', j.s->>'dedupe_key', j.sid,
      case j.verdict when 'verified' then true when 'unverified' then false else null end
    from judged j where j.verdict <> 'outside' order by j.ord
    on conflict (user_id, dedupe_key) do nothing
    returning dedupe_key)
  select
    (select coalesce(jsonb_agg(dedupe_key), '[]'::jsonb) from ins),
    (select coalesce(jsonb_agg(j.s->>'dedupe_key'), '[]'::jsonb) from judged j where j.verdict = 'verified' and j.s->>'dedupe_key' in (select dedupe_key from ins)),
    (select coalesce(jsonb_agg(j.s->>'dedupe_key'), '[]'::jsonb) from judged j where j.verdict = 'outside')
  into v_keys, v_verified, v_rejected;

  return jsonb_build_object('device_id', v_dev, 'inserted_keys', v_keys, 'verified_keys', v_verified, 'rejected_keys', v_rejected);
end $$;
revoke all on function public.ingest_wearable_batch(jsonb, jsonb) from public, anon;
grant execute on function public.ingest_wearable_batch(jsonb, jsonb) to authenticated;
