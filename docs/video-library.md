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

## Validation sample and duplicate review (read-only helpers)

None of these commands touch Supabase, the ZIP or the network unless noted. They only read `manifest.jsonl`.

```bash
# Build the agreed 25-video validation sample (10 matched, 8 needs_review, 7 named unmatched videos).
npm run video:sample -- --workdir .video-library
#    -> .video-library/sample.txt (one SHA-256 per line) and sample-plan.csv

# Duplicate review sidecar (no database column exists for duplicate paths, so it stays a CSV).
npm run video:duplicates -- --workdir .video-library
#    -> .video-library/duplicates.csv

# Dry run of exactly those videos (default; add --execute only after separate approval):
npm run video:ingest -- --zip /path/to/library.zip --workdir .video-library --sample-file .video-library/sample.txt
```

**`video:sample`** selects every `matched` video, every `needs_review` video, and seven `unmatched` videos by *exact*
title (see `EXPECTED_SAMPLE` in `scripts/video-library/sample.ts`). It checks the counts (10/8/7), 25 distinct hashes
and the byte totals. If anything differs it stops with a discrepancy report and writes nothing; it never substitutes
another video. Being in the sample means nothing for publishing: it maps nothing and approves nothing, and the seven
unmatched videos keep `exercise_key = null`.

**`--sample-file <path>`** restricts ingest to the listed hashes. Every hash is checked against the manifest first:
malformed (must be 64 lowercase hex characters), unknown, listed twice, or not an `ok` entry are all rejected, with
every problem reported together. Blank lines and lines starting with `#` are ignored. A hash whose bytes also appear
as `duplicate` records resolves to the kept (`ok`) entry. `ingest-state.json` and every other ingest protection still
apply. The run prints a per-file plan (SHA-256, file, path, review status, suggested key, size, intended catalog row).
It cannot be combined with `--limit` or `--only-matched`: those filters apply after the state filter and would silently
drop listed videos, so the combination is rejected instead of guessed at. `--limit` must now be a whole number (a
non-number used to select nothing without any message).

**`duplicates.csv`** has one row per SHA-256 with duplicates: `sha256, kept_path, duplicate_paths, kept_title,
duplicate_titles, titles_differ, proposed_canonical_title, review_decision`. Several values in a cell are joined with
` | ` (`duplicate_titles` follows the order of `duplicate_paths`). `titles_differ` ignores case and extra whitespace.
`proposed_canonical_title` is blank whenever titles differ (and when titles differ only by case/spacing); no title is ever
chosen from manifest order. `review_decision` is always blank for you to fill in. Rows with conflicting titles come first.

On Windows `cmd`, set environment variables with `set NAME=value` instead of `export`.

## ffprobe enrichment (`video:probe`, optional)

A separate, optional step. For the videos named in a sample file it extracts each file to a temporary path, runs
`ffprobe`, and records what it found in a **sidecar**. It reads the ZIP locally; it makes no network calls, never
touches Supabase, and **never modifies `manifest.jsonl`**. `video:ingest` does not read the sidecar.

```bash
npm run video:probe -- --zip /path/to/library.zip --sample-file .video-library/sample.txt --workdir .video-library
#    -> .video-library/probe.jsonl and .video-library/probe-flags.csv
```

`--zip` and `--sample-file` are both required (probing is limited to a named sample). The sample file is validated
exactly as for ingest (malformed, unknown, repeated or non-`ok` hashes abort before anything is read). Each extracted
file is re-hashed against the manifest; a file whose bytes no longer match is not probed and is flagged
`archive_mismatch`. Extracted files are deleted straight after probing.

**If ffprobe is not installed** the step is skipped, not failed: it prints a message, exits 0 and writes nothing (an
earlier `probe.jsonl` is left exactly as it was). Check with `ffprobe -version` in the same terminal, install ffmpeg
(which includes ffprobe) and make sure it is on PATH, then run it again.

**`probe.jsonl`** holds one record per video, keyed by SHA-256: container name and major brand, duration, and for the
first video stream codec, profile, level, pixel format, width, height and display rotation, plus the first audio
stream's codec, profile, sample rate and channels, stream counts, the flags, and a `probedAt` timestamp. A new run
replaces the records for its own videos and keeps earlier results for other videos.

**`probe-flags.csv`** has one row per flag (errors first) and lists only videos that need attention.

| Flag | Severity | Meaning |
|---|---|---|
| `no_video_stream` | error | No real video stream (audio-only, or only cover art) |
| `invalid_duration` | error | Duration missing, zero or negative |
| `invalid_dimensions` | error | Width or height missing, zero or negative |
| `ffprobe_unreadable` | error | ffprobe could not read the file |
| `archive_mismatch` | error | The archive content no longer matches the manifest (not probed) |
| `not_in_archive` | error | The entry was not found in the archive (name, CRC and size must match) |
| `unexpected_video_codec` | warning | Video codec is not H.264 |
| `unexpected_pixel_format` | warning | Pixel format is not yuv420p (includes 4:2:2, 4:4:4, 10-bit, yuvj420p) |
| `unexpected_audio_codec` | warning | Audio is present and is not AAC (a silent video is fine) |

The baseline (H.264 / yuv420p / AAC) is `EXPECTED_MEDIA` in `scripts/video-library/probeAnalysis.ts`. It is an advisory
compatibility baseline, not a guarantee. A video with no flags can still fail to play on a particular device, and a
flagged one can still play. **Real-device testing in iPhone Safari is still required before anything is published.**
The probe also cannot tell whether the MP4's index (moov atom) sits at the start of the file, which affects how
quickly it starts streaming.
