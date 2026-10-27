# Workout video library (Stage 2: catalog foundation)

Video binaries never go in Git or the app bundle. Metadata lives in Postgres (`public.exercise_videos`), files live
in the private `exercise-videos` Storage bucket, and both are written only by the offline scripts below using the
service role. The browser can read published rows and sign playback URLs for them, nothing else.

## One-time setup (you run these; nothing is applied automatically)
1. Review and apply the two migrations in `supabase/migrations/20261027010000_*` and `..._0100_*`.
2. Install ffmpeg (for `ffprobe`) if you want duration/resolution recorded. Without it the fields stay empty and are
   marked `unavailable`.

## Steps
```bash
# 1. Inventory: read-only, no network. Resumable; safe to Ctrl-C and re-run.
npm run video:inventory -- --zip /path/to/library.zip --workdir .video-library
#    -> .video-library/manifest.jsonl, summary.json, review.csv

# 2. Look at summary.json (real counts, size, duplicates) and review.csv (what needs a human decision).

# 3. Dry run of the upload plan (default, touches nothing):
npm run video:ingest -- --zip /path/to/library.zip --workdir .video-library --limit 30 --only-matched

# 4. Sample upload, only after the migrations are applied and you approve:
export SUPABASE_URL=...            # shell only
export SUPABASE_SERVICE_ROLE_KEY=...  # shell only. Never a VITE_* variable, never committed.
npm run video:ingest -- --zip /path/to/library.zip --workdir .video-library --limit 30 --only-matched --execute
```

Re-running is safe: objects are content-addressed (`videos/<sha[0:2]>/<sha256>.mp4`), catalog rows are insert-only
(manual review decisions are never overwritten), and finished items are skipped using `ingest-state.json`.

## Matching rules
Exact key, name or alias match -> `matched`. Equipment conflicts and ties -> `needs_review`. Fuzzy matches only ever
produce a *suggestion* (`suggested_exercise_key`), never an exercise key. Everything else is `unmatched`. Only
`matched` + `uploaded` rows are visible to signed-in users.
