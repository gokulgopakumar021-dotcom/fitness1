# Body Scan: on-device pose model (Phase 2C)

Body Scan finds body landmarks in a photo **inside the browser**. Photos, frames and
landmarks are never uploaded. This file records exactly what is used, where it comes
from, and what has and has not been verified.

## What is used

| Item | Value |
| --- | --- |
| Runtime package | `@mediapipe/tasks-vision` **0.10.35**, pinned exactly (no `^`) |
| Runtime licence | Apache-2.0 (from the package metadata) |
| Model bundle | `pose_landmarker_full.task`, float16 ("Full" variant of BlazePose GHUM 3D) |
| Model licence | Apache License 2.0, as stated on Google's model card (see below) |
| Mode | `IMAGE` (one still photo at a time), `numPoses: 1`, CPU delegate, no segmentation masks |
| Served from | This app's own origin: `/models/pose_landmarker_full.task` (`public/models/`) |
| WASM runtime | Bundled by Vite as hashed files under `/assets/` (own origin, no CDN) |

### Why Full (not Lite or Heavy)
Inference runs once per accepted photo, so speed matters little. Google's model card
reports 2D accuracy (PDJ) of Lite 87.0%, Full 91.8%, Heavy 94.2%, and a smaller
skin-tone gap for Full than for Lite. Heavy is much larger to download. The variant is a
single constant (`POSE_MODEL_VARIANT` in `src/services/poseLandmarker.ts`) if this is
revisited.

### Model-card limits that matter here
Google's card states the model is intended for entertainment and similar uses, **not
life-critical decisions**; it tracks one person; it is sensitive to face position, scale
and lighting; Z (depth) is not metric. Accuracy differs across regions, skin tones and
genders (the card reports the gaps). That is why Body Scan reports only whether
landmarks were found and whether the framing looks usable, and makes no body-composition
or health claims.

## Why 0.10.35 and not a newer 1.x release

`@mediapipe/tasks-vision` **1.0.0 through 1.1.1** contain a usage-logging client that is
created with every task and posts to `https://odml.pa.googleapis.com/v1/log` (task type,
running mode, coarse OS family, library version and timing statistics; it flushes every
60 seconds and when the task is closed). I found no image or landmark fields in it, but
this was read from minified code and not observed at runtime, and I found no option to
turn it off. Because Body Scan must call `close()` to release resources, using 1.x would
cause a network request to Google, which conflicts with the "no third-party requests"
rule.

Versions **0.10.21 and 0.10.32 to 0.10.35** contain no such endpoint (audited in the
JavaScript bundle; the WASM binaries contain only protobuf type names). 0.10.35 is the
newest of them. `src/services/poseLandmarker.privacy.test.ts` fails if the dependency is
unpinned or changed to a version that has not been audited, or if the installed bundle
contains a network endpoint.

### To upgrade MediaPipe
1. Download the new tarball (`npm pack @mediapipe/tasks-vision@<version>`) and extract it.
2. Search `vision_bundle.mjs` and the `wasm/*.js` loaders for `https://`, `fetch(`,
   `XMLHttpRequest`, `sendBeacon`, `WebSocket`, and for any logging client.
3. Check `strings` on the `.wasm` files for URLs.
4. Only then add the version to `AUDITED_VERSIONS` in the privacy test and bump the pin.

## Getting the model file into the repository

The model is **not** downloaded by the app at runtime and **not** fetched at build time.
It is a file in `public/models/`, copied into the build like any static asset.

1. On a machine with normal internet access run `npm run fetch:pose-model`. It downloads
   from Google's official bucket, refuses anything that looks like a web page, and prints
   the byte size and SHA-256.
   Source URL:
   `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task`
2. Record the values below, then commit the `.task` file together with this record.
3. For repeatable checks use `npm run fetch:pose-model -- --expect <sha256>`.

Until the file is present the app shows a clear "pose model file is not available"
message with a retry button, and the rest of Iron Log is unaffected.

| Recorded value | |
| --- | --- |
| Downloaded on | _not yet recorded_ |
| Size in bytes | _not yet recorded_ |
| SHA-256 | _not yet recorded_ |

> `latest` in the URL is a moving alias. Recording the SHA-256 is what pins the model.

### Redistribution
The model card states Apache License 2.0. Apache-2.0 permits redistribution provided the
licence text and notices travel with the work. When the `.task` file is committed, also
keep a copy of the Apache-2.0 licence (https://www.apache.org/licenses/LICENSE-2.0) and
credit "MediaPipe Pose Landmarker (BlazePose GHUM 3D), Google, Apache-2.0" in the app's
third-party notices. The model card is at
`https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf`.

## Network behaviour (what the browser requests)

| Request | When | Where | Contains |
| --- | --- | --- | --- |
| `GET /models/pose_landmarker_full.task` | first photo analysis in a session | own origin | nothing (plain GET, no body) |
| `GET /assets/vision_bundle-*.js` | same moment (lazy chunk) | own origin | nothing |
| `GET /assets/vision_wasm_*internal-*.{js,wasm}` | same moment | own origin | nothing |

No request carries a photo, a frame or a landmark. The model is held in memory only and
released after two minutes without use.

## Validation behaviour in this version (advisory, not a gate)

Pose results are **advisory**. Nothing is measured, scored or saved from them in this
version, so a `partial` or `failed` result never blocks "Use this photo", retaking, or
discarding. The result panel explains what was found and what to change, and the footer
under the two photo cards (`summariseSession` in `CaptureSession.tsx`) reflects the real
outcome: it says both photos show a usable pose only when both were `usable`, says
photos are still being checked while an analysis runs, and otherwise says at least one
needs another look. If a later phase starts measuring or saving from these landmarks, it
should decide then whether to gate on `usable`.

## Provisional thresholds

These two rules were introduced in Phase 2C and are **not calibrated on real photos,
people or devices**. Boundary tests in `poseDetectionAssessment.test.ts` pin today's
behaviour only; they do not show the values are right.

| Rule | Value | What it does | Limitation |
| --- | --- | --- | --- |
| `MIN_RELIABLE_FRACTION_FOR_PARTIAL` | 0.5 (half, rounded up) | Fewer reliable required landmarks than this fails the photo | Front needs 5 of 9, side 3 of 5. The model card reports accuracy gaps across skin tones and genders, so a fixed fraction may treat people unequally. |
| `MIN_POSE_VERTICAL_SPAN` | 0.05 of image height | Reliable required points spanning less than this are treated as a collapsed pose | Only catches near-flat output; says nothing about a plausible but wrong pose |

Still required before calling these settled: run the real model on a diverse set of front
and side photos (different body types, skin tones, clothing, lighting, distances) on at
least one iOS and one Android device, and record the outcomes.

## Completion status

Not complete. The model file has not been added: it could not be downloaded from the
build environment, so its size, SHA-256 and licence notice are still unrecorded in the
table above, and no real-model inference has been run.

## Known limitations
- `detect()` is synchronous inside MediaPipe, so analysis runs on the main thread and the
  page can pause for a moment. The engine yields to the browser first so an "analysing"
  message can appear. Moving it to a Web Worker is a sensible later change but needs
  testing on real devices.
- Nothing here has been run against the real model on a real photo or device in the
  development sandbox: the model file could not be downloaded there. All automated
  tests use a fake engine and synthetic landmarks.
- The acceptance rules (at least half of the required points reliable; collapsed-pose
  check) are new Phase 2C heuristics and are not calibrated on real users.
- The runtime and model are about 22 MB (SIMD) before compression on first use; browsers
  cache them afterwards.
