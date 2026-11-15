-- BT-04 wearable foundation. Applied to the live project on 2026-11-15 as version 20261115131442 (name: wearable_foundation).
-- Idempotent where practical.
--
-- Ownership model: every row carries user_id = auth.uid(); RLS restricts all access to the owner; devices are linked to
-- samples with a COMPOSITE foreign key so a sample can never point at another user's device. Simulated data has no
-- legal origin value, so it cannot be stored. Provider credentials live in a table no client role can touch.

create table if not exists public.wearable_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (char_length(provider) between 1 and 64),
  ingestion_method text not null check (ingestion_method in ('direct_ble','cloud_api','aggregator','native_health_store','manual_import')),
  status text not null default 'pending' check (status in ('pending','active','error','revoked')),
  external_account_ref text check (external_account_ref is null or char_length(external_account_ref) <= 200),
  scopes text[] not null default '{}',
  last_sync_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index if not exists wearable_connections_one_per_account
  on public.wearable_connections (user_id, provider, coalesce(external_account_ref, ''));

create table if not exists public.wearable_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid,
  device_key text not null check (char_length(device_key) between 1 and 200),
  manufacturer text not null check (char_length(manufacturer) between 1 and 100),
  model text check (model is null or char_length(model) <= 100),
  display_name text check (display_name is null or char_length(display_name) <= 100),
  ingestion_method text not null check (ingestion_method in ('direct_ble','cloud_api','aggregator','native_health_store','manual_import')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, ingestion_method, device_key),
  foreign key (connection_id, user_id) references public.wearable_connections (id, user_id) on delete cascade
);

create table if not exists public.wearable_samples (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  metric text not null check (metric in ('heart_rate','resting_heart_rate','hrv_rmssd','hrv_sdnn','steps','active_energy','total_energy','distance','workout_duration','sleep_duration','blood_oxygen','respiratory_rate')),
  value double precision not null check (value = value and value between -1e9 and 1e9),
  unit text not null check (unit in ('bpm','ms','count','kcal','m','s','percent','breaths_per_min')),
  measured_at timestamptz not null,
  measured_end_at timestamptz,
  tz_offset_min smallint check (tz_offset_min is null or tz_offset_min between -840 and 840),
  source_record_id text check (source_record_id is null or char_length(source_record_id) <= 200),
  -- 'simulated' is deliberately not allowed: demo data can never be stored.
  origin text not null check (origin in ('live','synchronized','manual')),
  quality text not null default 'unverified' check (quality in ('device_reported','user_entered','derived','unverified')),
  imported_at timestamptz not null default now(),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 600),
  check (measured_end_at is null or measured_end_at >= measured_at),
  check ((metric in ('heart_rate','resting_heart_rate') and unit = 'bpm')
      or (metric in ('hrv_rmssd','hrv_sdnn') and unit = 'ms')
      or (metric = 'steps' and unit = 'count')
      or (metric in ('active_energy','total_energy') and unit = 'kcal')
      or (metric = 'distance' and unit = 'm')
      or (metric in ('workout_duration','sleep_duration') and unit = 's')
      or (metric = 'blood_oxygen' and unit = 'percent')
      or (metric = 'respiratory_rate' and unit = 'breaths_per_min')),
  unique (user_id, dedupe_key),
  foreign key (device_id, user_id) references public.wearable_devices (id, user_id) on delete cascade
);
create index if not exists wearable_samples_user_metric_time on public.wearable_samples (user_id, metric, measured_at desc);

-- Separate, explicit, revocable consent for sending wearable data to an external AI provider. No row = no consent.
create table if not exists public.wearable_ai_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null check (version >= 1),
  categories text[] not null check (cardinality(categories) >= 1 and categories <@ array['live_heart_rate','sleep_and_recovery_metrics','activity_metrics']),
  granted_at timestamptz not null default now()
);

-- Provider secrets are never readable by browser roles. Only a reference to a secret store is kept; service_role only.
create table if not exists public.wearable_provider_credentials (
  connection_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  secret_ref text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (connection_id, user_id) references public.wearable_connections (id, user_id) on delete cascade
);

alter table public.wearable_connections enable row level security;
alter table public.wearable_devices enable row level security;
alter table public.wearable_samples enable row level security;
alter table public.wearable_ai_consents enable row level security;
alter table public.wearable_provider_credentials enable row level security;

revoke all on public.wearable_connections, public.wearable_devices, public.wearable_samples,
  public.wearable_ai_consents, public.wearable_provider_credentials from anon, authenticated;
revoke all on public.wearable_provider_credentials from public;

-- Clients read their own rows and may delete them (revocation / data deletion). Cloud-provider writes use service_role.
grant select, delete on public.wearable_connections, public.wearable_devices, public.wearable_samples to authenticated;
grant insert on public.wearable_devices, public.wearable_samples to authenticated;
grant select, insert, update, delete on public.wearable_ai_consents to authenticated;

drop policy if exists wearable_connections_own on public.wearable_connections;
create policy wearable_connections_own on public.wearable_connections for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists wearable_connections_delete_own on public.wearable_connections;
create policy wearable_connections_delete_own on public.wearable_connections for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists wearable_devices_select on public.wearable_devices;
create policy wearable_devices_select on public.wearable_devices for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists wearable_devices_insert on public.wearable_devices;
create policy wearable_devices_insert on public.wearable_devices for insert to authenticated with check (user_id = (select auth.uid()) and connection_id is null);
drop policy if exists wearable_devices_delete on public.wearable_devices;
create policy wearable_devices_delete on public.wearable_devices for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists wearable_samples_select on public.wearable_samples;
create policy wearable_samples_select on public.wearable_samples for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists wearable_samples_insert on public.wearable_samples;
create policy wearable_samples_insert on public.wearable_samples for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists wearable_samples_delete on public.wearable_samples;
create policy wearable_samples_delete on public.wearable_samples for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists wearable_ai_consents_own on public.wearable_ai_consents;
create policy wearable_ai_consents_own on public.wearable_ai_consents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- wearable_provider_credentials: RLS on, no policies, no grants => unreadable by anon/authenticated.
