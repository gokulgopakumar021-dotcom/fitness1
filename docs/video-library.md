# Workout video library (Stage 2: catalog foundation)

Video binaries never go in Git or the app bundle. Metadata lives in Postgres (`public.exercise_videos`), files live
in the private `exercise-videos` Storage bucket, and both are written only by the offline scripts below using the
service role. The browser can read published rows and sign playback URLs for them, nothing else. A row is
"published" only after you run `supabase/manual/publish_videos.sql` yourself; ingestion never publishes (see "Publishing").

## One-time setup (you run these; nothing is applied automatically)
1. Review and apply the migrations in `supabase/migrations/` in order: `20261027010000_*`, `20261027010100_*`, then
   `20261028000000_exercise_videos_published.sql` (adds the `published` flag and switches the table and storage
   policies to it; its header has the rollback).
2. Install ffmpeg (for `ffprobe`) if you want duration/resolution recorded. Without it the fields stay empty and are
   marked `unavailable`.

## Steps
Nothing is uploaded or published unless a successful media probe exists for that exact file (see "Probe gate" below).
Run the steps in this order. Everything before step 6 is read-only and offline.

```bash
# 1. Inventory: read-only, no network. Resumable; safe to Ctrl-C and re-run.
npm run video:inventory -- --zip /path/to/library.zip --workdir .video-library
#    -> .video-library/manifest.jsonl, summary.json, review.csv

# 2. Review: look at summary.json (real counts, size, duplicates) and review.csv (what needs a human decision).

# 3. Choose the videos: build the validation sample (or write your own sample.txt, one SHA-256 per line).
npm run video:sample -- --workdir .video-library
#    -> .video-library/sample.txt

# 4. Probe exactly those videos (needs ffprobe on PATH: `ffprobe -version`). Read-only, no network.
npm run video:probe -- --zip /path/to/library.zip --sample-file .video-library/sample.txt --workdir .video-library
#    -> .video-library/probe.jsonl and probe-flags.csv. Fix or drop any video with an error flag, then re-run.

# 5. Dry run (default, touches nothing). Each video shows "probe: passed" or "probe: REJECTED (...)".
npm run video:ingest -- --zip /path/to/library.zip --workdir .video-library --sample-file .video-library/sample.txt

# 6. Upload, only after the migrations are applied and you approve:
export SUPABASE_URL=...            # shell only
export SUPABASE_SERVICE_ROLE_KEY=...  # shell only. Never a VITE_* variable, never committed.
npm run video:ingest -- --zip /path/to/library.zip --workdir .video-library --sample-file .video-library/sample.txt --execute
```

`--limit N` / `--only-matched` still work instead of `--sample-file`, but the probe step needs a sample file, so
list those videos' hashes in one first. Real devices: still test playback in iPhone Safari before publishing.

## Probe gate
`video:ingest` reads `probe.jsonl` and uploads a video only if its record (looked up by SHA-256, which the probe
re-checked against the archive bytes) is a successful probe of the same size, with no blocking flag. It rejects a video
when: `probe.jsonl` is missing (including when ffprobe was not installed, because the probe then writes nothing); there
is no record for that hash (never probed, or probed before the file changed); the record is `unreadable`,
`archive_mismatch` or `not_in_archive`; the measurement is incomplete; or any error flag applies (`no_video_stream`,
`invalid_duration`, `invalid_dimensions`, `ffprobe_unreadable`, ...). Warnings (not H.264, not yuv420p, non-AAC audio)
and a silent video do not block. There is no bypass flag.

A rejected video is skipped before anything is extracted or written: no catalog row, no object, no `ingest-state.json`
entry. Dry run lists the rejections and exits normally; `--execute` skips them, uploads the rest and exits with code 1,
or stops immediately when `probe.jsonl` does not exist. After fixing the problem, re-run the probe and then ingest.
Videos already recorded as uploaded are skipped and not re-checked.

Re-running is safe: objects are content-addressed (`videos/<sha[0:2]>/<sha256>.mp4`), catalog rows are insert-only
(manual review decisions are never overwritten), and finished items are skipped using `ingest-state.json`.

## Matching rules
Exact key, name or alias match -> `matched`. Equipment conflicts and ties -> `needs_review`. Fuzzy matches only ever
produce a *suggestion* (`suggested_exercise_key`), never an exercise key. Everything else is `unmatched`.
`review_status` only describes the exercise-key mapping. It does not control visibility: signed-in users see a row
when it is `uploaded` AND `published`. The posture modal additionally asks for `matched` rows, so it never shows a video
that has no reviewed exercise key.

## Publishing (separate, deliberate, run by you)
New rows are inserted with `published = false`. To make videos visible in the Video Library screen:

1. Collect the SHA-256 hashes you approve (from `manifest.jsonl` or `sample.txt`).
2. Open `supabase/manual/publish_videos.sql`, replace the example hashes, review it, and run it in the Supabase SQL
   Editor. It is all-or-nothing: it refuses (and changes nothing) if any hash is malformed, unknown, or not `uploaded`.
3. Run the check query at the bottom of the file.

To hide videos again run `supabase/manual/unpublish_videos.sql` the same way. A signed URL someone already holds
keeps working until it expires (one hour). Nothing in this repository sets `published = true`, and a database
constraint stops a row that is not `uploaded` from being published.

On Windows PowerShell, turn a hash-per-line `sample.txt` into the quoted list for the SQL file with:
`(Get-Content .video-library\sample.txt | Where-Object { $_ -match '^[0-9a-f]{64}$' } | ForEach-Object { "'$_'" }) -join ",`n"`

## Video Library screen
Navigation: Train group in the desktop sidebar, and the mobile "More" sheet. Search is debounced (300 ms, Enter searches
at once), case-insensitive, matches the start of each typed word in the title (`ben pre` finds "Bench Press"), and
loads 24 results per page with a "Show more" button. An empty box browses the whole library A to Z, one page at a time.
Opening a video signs one playback URL for that video only.

## Ingesting the rest of the library in batches (`video:batch`)

`video:sample` is fixed to the agreed 25-video validation sample. For everything else, `video:batch` plans the NEXT batch.
It is offline and read-only on the manifest (no ZIP, no network, no Supabase) and it never overwrites a file.

```bash
npm run video:batch -- --workdir .video-library            # defaults: 50 videos, 100 MB per batch
npm run video:batch -- --workdir .video-library --size 40 --max-mb 60
#    -> .video-library/batches/batch-NN.txt          (sample file for video:probe and video:ingest)
#       .video-library/batches/batch-NN.plan.csv      (what each video would become in the catalog)
#       .video-library/batches/batch-NN.publish.sql   (supabase/manual/publish_videos.sql with this batch's hashes)
```

Eligible videos are `ok` manifest entries that are not already uploaded (`ingest-state.json`), not in `sample.txt` and not in
an earlier `batch-*.txt`, so each run plans the batch after the previous one and an existing batch file is never renumbered
or changed. A failed upload is not "uploaded", so it is picked up again. Videos with the same title (the `girl/` and `men/`
variants) stay in one batch whenever the group fits. Planning a batch maps nothing, approves nothing and publishes nothing.

Per batch, in this order (you run every step yourself):

1. `npm run video:batch -- --workdir .video-library`
2. `npm run video:probe -- --zip "%ZIP%" --sample-file .video-library\batches\batch-NN.txt --workdir .video-library`
3. Read `.video-library\probe-flags.csv`. Fix or drop any error-severity video and re-probe. There is no bypass.
4. Dry run: `npm run video:ingest -- --zip "%ZIP%" --workdir .video-library --sample-file .video-library\batches\batch-NN.txt`
5. Same command with `--execute` (you set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your own shell).
6. Review `batch-NN.publish.sql`, then run it in the Supabase SQL Editor. It refuses unless every hash is `uploaded`.

## Mapping videos to exercise keys (manual review, key-first)

The app only knows a few dozen exercise keys (the exercise index), so you review "which videos show this exercise?"
once per key instead of judging every video. Both commands are offline: they read `manifest.jsonl`, write local files,
and never connect to Supabase.

```bash
# 1. For every exercise key, the best-scoring videos (title overlap). Writes mapping/candidates-NN.csv, never overwrites.
npm run video:map-candidates -- --workdir .video-library            # --per-key 6 --min-score 0.4 by default

# 2. Open the CSV in a spreadsheet and fill ONLY the decision column, then save it as CSV:
#      map                 this video shows this exercise
#      map_equipment_ok    same, and the equipment really differs on purpose (e.g. dumbbell video for a cable exercise)
#      skip                not this exercise (it will not be offered for this key again)
#      (blank)             decide later; nothing is recorded
#    Optional: sort_order (whole number) to put one video first. Blank = after existing videos, in file order.

# 3. Validate it and write the SQL:
npm run video:map-sql -- --csv .video-library/mapping/candidates-01.csv --workdir .video-library
#    -> candidates-01.map.sql (guarded, run it yourself) and mapping/decisions.jsonl (append-only ledger)
```

Run the generated `.map.sql` in the SQL Editor only after those videos are uploaded. It is all-or-nothing and sets
`exercise_key`, `review_status = 'matched'`, `match_method = 'manual'`, `match_confidence = 1`, `sort_order`, and adds a
`demo:female` / `demo:male` tag from the archive folder (`girl/` / `men/`). It never sets `published`: the posture modal
shows a video only when it is matched AND published, so run `publish_videos.sql` for it as usual.

Decisions are never overwritten:
- the SQL only changes rows that are still `needs_review` or `unmatched`; one row that is already matched (automatically
  or manually, with another key) or rejected stops the whole run and changes nothing;
- the ledger refuses a different key for a video it already mapped, and a damaged ledger stops every command;
- candidate files skip mapped videos, auto-matched videos and every (video, key) pair you skipped;
- a CSV with any problem is rejected as a whole, with every problem listed, and records nothing.

The ledger records what you decided when the SQL was generated, not whether you ran it. The database is the source of
truth: the SQL's guards check the live rows. Re-running the same SQL is harmless.

A key must exist in the exercise index (`src/data/exerciseIndex.ts`) to be accepted: a video mapped to a key the workout
screen can never resolve would never be shown. Adding keys is a code change to that index, not a CSV edit.

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

## ffprobe enrichment (`video:probe`, required before upload)

A separate step, required before ingest uploads anything. For the videos named in a sample file it extracts each file to a temporary path, runs
`ffprobe`, and records what it found in a **sidecar**. It reads the ZIP locally; it makes no network calls, never
touches Supabase, and **never modifies `manifest.jsonl`**. `video:ingest` reads the sidecar as a safety gate (see "Probe gate" above).

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
