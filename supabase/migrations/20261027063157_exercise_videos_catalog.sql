-- Iron Log: workout video library catalog (metadata only).
--
-- Video binaries are NOT stored in Postgres or Git; they live in a private Storage bucket (see the next
-- migration). This table maps each uploaded video to an Iron Log exercise key and carries review state.
--
-- Write model: rows are created/updated ONLY by the offline ingestion script using the service role
-- (which bypasses RLS). Browsers get read-only access, and only to rows that are uploaded AND reviewed
-- (status = 'uploaded' and review_status = 'matched'). There is no INSERT/UPDATE/DELETE policy or privilege
-- for anon or authenticated, so no signed-in user can edit the catalog. Idempotent: safe to run twice.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.exercise_videos (
  id                   uuid primary key default gen_random_uuid(),
  content_sha256       text not null,                       -- identity of the file; makes ingestion idempotent
  original_filename    text not null,
  title                text not null,
  exercise_key         text,                                -- Iron Log exercise key; null until matched
  suggested_exercise_key text,                              -- fuzzy suggestion awaiting human review (never shown to users)
  storage_key          text not null,                       -- object path inside the private bucket
  size_bytes           bigint not null,
  duration_seconds     numeric(8,2),
  width                integer,
  height               integer,
  equipment            text[] not null default '{}',
  muscle_groups        text[] not null default '{}',
  tags                 text[] not null default '{}',
  match_method         text not null default 'none',
  match_confidence     numeric(3,2) not null default 0,
  review_status        text not null default 'needs_review',
  status               text not null default 'pending',
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  search_vector        tsvector generated always as (
                         to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(original_filename, ''))
                       ) stored,
  constraint exercise_videos_sha256_format check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint exercise_videos_sha256_unique unique (content_sha256),
  constraint exercise_videos_storage_key_unique unique (storage_key),
  constraint exercise_videos_filename_length check (char_length(original_filename) between 1 and 255),
  constraint exercise_videos_title_length check (char_length(title) between 1 and 200),
  constraint exercise_videos_key_length check (exercise_key is null or char_length(exercise_key) between 1 and 100),
  constraint exercise_videos_suggested_key_length check (suggested_exercise_key is null or char_length(suggested_exercise_key) between 1 and 100),
  constraint exercise_videos_size_positive check (size_bytes > 0),
  constraint exercise_videos_duration_nonneg check (duration_seconds is null or duration_seconds >= 0),
  constraint exercise_videos_dims_positive check ((width is null or width > 0) and (height is null or height > 0)),
  constraint exercise_videos_match_method check (match_method in ('exact_key', 'exact_name', 'exact_alias', 'fuzzy', 'manual', 'none')),
  constraint exercise_videos_confidence_range check (match_confidence between 0 and 1),
  constraint exercise_videos_review_status check (review_status in ('matched', 'needs_review', 'unmatched', 'rejected')),
  constraint exercise_videos_status check (status in ('pending', 'uploaded', 'failed')),
  -- A video can only be 'matched' if it actually has an exercise key.
  constraint exercise_videos_matched_has_key check (review_status <> 'matched' or exercise_key is not null)
);

comment on table public.exercise_videos is 'Workout video catalog (metadata only). Binaries live in the private exercise-videos bucket. Written by the service role only.';

-- Serves the in-workout lookup: "published videos for exercise X, in order".
create index if not exists exercise_videos_published_by_exercise_idx
  on public.exercise_videos (exercise_key, sort_order, id)
  where status = 'uploaded' and review_status = 'matched';

create index if not exists exercise_videos_search_idx on public.exercise_videos using gin (search_vector);
create index if not exists exercise_videos_title_trgm_idx on public.exercise_videos using gin (title extensions.gin_trgm_ops);
create index if not exists exercise_videos_tags_idx on public.exercise_videos using gin (tags);
create index if not exists exercise_videos_equipment_idx on public.exercise_videos using gin (equipment);
create index if not exists exercise_videos_muscles_idx on public.exercise_videos using gin (muscle_groups);
create index if not exists exercise_videos_review_idx on public.exercise_videos (review_status, status);

alter table public.exercise_videos enable row level security;

-- Defence in depth: privileges are narrowed independently of the policy below.
revoke all on public.exercise_videos from anon, authenticated;
grant select on public.exercise_videos to authenticated;

drop policy if exists "exercise_videos_select_published" on public.exercise_videos;
create policy "exercise_videos_select_published"
  on public.exercise_videos for select
  to authenticated
  using (status = 'uploaded' and review_status = 'matched');

-- public.set_updated_at() is created by the profiles migration; redefined here only if absent so this file
-- also works on its own.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists exercise_videos_set_updated_at on public.exercise_videos;
create trigger exercise_videos_set_updated_at
  before update on public.exercise_videos
  for each row execute function public.set_updated_at();
