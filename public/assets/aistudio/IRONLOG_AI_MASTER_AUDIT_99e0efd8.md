# IRONLOG AI — Master Technical Audit

**Repository:** gokulgopakumar021-dotcom/fitness1 · **Branch audited:** `main` @ `64a816c` (ironlog-ai-rebrand) · **Audit date:** 2026-10-31
**Mode:** read-only. Fresh clone in a sandbox; no repo files were modified, no commits, no pushes, no deploys. `npm ci` was run in the sandbox copy only (installs the lockfile's existing dependencies; `node_modules` is gitignored).

Companion documents: `IRONLOG_AI_SYSTEM_ARCHITECTURE.md`, `IRONLOG_AI_SECURITY_AUDIT.md`, `IRONLOG_AI_PERFORMANCE_AUDIT.md`, `IRONLOG_AI_MOBILE_COMPATIBILITY.md`, `IRONLOG_AI_TEST_COVERAGE.md`, `IRONLOG_AI_REMEDIATION_ROADMAP.md`.

---

## 1. Executive summary

IRONLOG AI is a client-heavy React 19 + Vite 8 app with a thin Express server (`server.ts`, 1,691 lines) that proxies Gemini calls. User fitness data lives entirely in the browser (localStorage / IndexedDB, namespaced per Supabase account). Supabase provides auth, a profile table and a private video catalog.

**Verified working today:** `tsc --noEmit` passes; 125 test files / 2,127 tests pass; production build succeeds. Supabase RLS in the migrations is well constructed (static review). Body Scan has a notably careful privacy design (explicit consent, CPU-only local inference, model integrity checking).

**The foundation is not yet ready for mobile.** The five issues that must be resolved first:

| # | Finding | Severity | Why it blocks |
|---|---|---|---|
| 1 | SEC-01 — all 17 AI endpoints are unauthenticated | CRITICAL | Open Gemini proxy: anyone who finds the URL can spend your quota. Mobile apps make this URL public by design. |
| 2 | MOB-01 — every API call uses a relative `/api/...` URL | CRITICAL (mobile) | In a Capacitor app there is no Express server at that origin. All AI features and the barcode lookup would fail. |
| 3 | SEC-02 — no rate/usage limits, 25 MB JSON body on every route | HIGH | Cost and availability exposure; compounds SEC-01. |
| 4 | FN-01 — Exercise Coach calls a route that does not exist | HIGH | Client posts to `/api/ai-exercise-coach`; server defines `/api/exercise-coach`. |
| 5 | FN-02 — no React error boundary anywhere | HIGH | Any render exception white-screens the whole app, and native apps have no refresh button. |

Also significant: a single 2.26 MB (631 kB gzip) JS bundle with no code splitting (PF-01); no CI, no ESLint, no coverage tooling, no server tests (TST-01..04); Capacitor dependencies are installed but there are no `android/` or `ios/` projects and no `@capacitor/*` imports in `src/` (MOB-02).

**Capacitor is a suitable choice** for this architecture (Vite SPA → `dist`), provided the API/auth layer is redesigned first (see Mobile document).

## 2. Method and honest limits

Performed: repository inventory; targeted source reading of `server.ts`, auth, storage, Supabase client, migrations, Workout Mirror, Body Scan loader/camera, notification/voice/Bluetooth services; grep-based surveys of browser APIs, validation, error handling, a11y attributes; `npm run lint`, `npm test`, `vite build`, `npm audit`.

**Not performed (so nothing below claims it works):**
- No live server run; no HTTP calls to AI endpoints; no Gemini calls. The model id `gemini-3.8-flash` (hardcoded 15 times) was **not** verified against the API.
- No live Supabase project inspection. RLS was reviewed from migration SQL and the repo's PGlite tests, not from the deployed database.
- No browser or device testing: camera, MediaPipe inference, rep counting, voice and FPS are **not measured**.
- No Lighthouse, memory profiling, or API latency measurement.
- Not every one of the 317 source files was read line-by-line. Findings come from targeted reading plus tooling; absence from this report is not proof of absence.
- The 12 other remote branches (e.g. `feature/iron-log-premium-ui`, `feature/video-library-search`) were not audited.

## 3. Module classification (Stage 2)

Legend: **V** verified · **PV** implemented, partially verified · **KD** implemented with known defects · **UI** UI only / incomplete integration · **NI** not implemented.

| Module | Class | Main files | Dependencies | Tests | Known defects / notes |
|---|---|---|---|---|---|
| Auth & session | PV | `src/context/AuthContext.tsx`, `src/lib/supabase.ts`, `components/auth/*` | Supabase Auth (PKCE) | `authValidation.test.ts`, RLS tests | Email-link flow not mobile-ready (MOB-03) |
| Per-account storage | PV | `storage/storageScope.ts`, `storage/db.ts` (962 lines) | localStorage, IndexedDB | storageScope, resetAll, accountErase tests | Client-side separation only, by the code's own admission (SEC-07) |
| Workout tracking | PV | `components/workouts/WorkoutSessionTracker.tsx` (1,232 lines), `utils/calculations.ts` | db.ts | workout, volumeLoad, design-compliance tests | Exercise Coach route mismatch (FN-01) |
| Progression / PRs | PV | `components/progression/ProgressionView.tsx` (1,387 lines) | `/api/ai-plan-overload-tuning` | partial | Oversized component |
| Plans / routines | KD | `components/plans/*`, `utils/aiRoutineEngine.ts` | `/api/extract-plan`, `/api/generate-plan`, `/api/generate-ai-routine` | 2 test files | Client-supplied MIME passed to Gemini unvalidated (SEC-04) |
| Nutrition | PV | `components/nutrition/*` (24 files), `data/foodDatabase.ts` | `/api/ai-food-parser`, `/api/nutrition/barcode/:id` → Open Food Facts | 13 test files | Barcode proxy validated, 8 s timeout, in-memory cache (good) |
| Barcode scanner | PV | `nutrition/BarcodeScanner.tsx` (783 lines) | html5-qrcode, getUserMedia | limited | Web camera dependency (MOB-09) |
| Recovery / mobility / muscle map | PV | `components/recovery/*`, `utils/muscleMap/*` | `/api/ai-recovery-insights` | 4 test files | — |
| AI Trainer | KD | `components/trainer/*`, server `/api/ai-personal-trainer` | Gemini | 5 test files | No auth, no usage limits, no per-user cap (SEC-01/02) |
| Workout Mirror | PV | `components/workoutMirror/*`, `services/workoutMirror/*` | MediaPipe (CPU), speechSynthesis, camera | 5 test files + engine tests | No exercise *recognition*, manual pick only (FN-04); init failure caches rejected promise (FN-03) |
| Body Scan | PV | `components/bodyscan/*`, `services/poseLandmarker.ts`, `camera.ts`, `storage/bodyScanStore.ts` | MediaPipe (CPU), IndexedDB | 5 component + util tests, model integrity test | Inference never run in this audit; strong privacy design |
| Analytics / timeline / reports | PV | `timeline/ProgressTimelineView.tsx` (1,148 lines), `reports/*` | db.ts | timeline test | — |
| Sleep | UI/PV | `components/sleep/*` | db.ts | **0 tests** | Untested (TST-03) |
| Video library | PV | `services/videoCatalogService.ts`, `components/video/*`, `scripts/video-library/*` | Supabase table + private bucket, signed URLs | 8 test files + 20+ script tests | Live catalog state not verified |
| Bluetooth HR | UI (web-only) | `services/bluetoothFitness.ts`, `context/BluetoothGadgetContext.tsx` | Web Bluetooth | none found | Will not work in iOS/Android WebViews (MOB-06) |
| PWA | UI (manifest only) | `public/manifest.webmanifest`, `index.html` | — | `brand.test.ts` | **No service worker**: no offline, no install-time caching (MOB-10) |
| Cloud data sync | NI | — | — | — | README states it is not implemented (FN-05) |
| Logging / monitoring | NI | 31 `console.*` calls in `src/`, 17 in `server.ts` | — | — | No error reporting dependency in `package.json` |
| Error handling | KD | scattered try/catch | — | — | No ErrorBoundary (FN-02); server leaks `error.message` (SEC-03) |

## 4. Finding index

| ID | Severity | Title | Doc |
|---|---|---|---|
| SEC-01 | CRITICAL | Unauthenticated AI/API endpoints | Security |
| MOB-01 | CRITICAL (mobile) | Relative `/api` URLs cannot work in native shell | Mobile |
| SEC-02 | HIGH | No rate limits/usage caps; 25 MB global body limit | Security |
| FN-01 | HIGH | Exercise Coach route mismatch | Master §5 |
| FN-02 | HIGH | No React error boundary | Master §5 |
| PF-01 | HIGH | Single 2.26 MB entry chunk, no code splitting | Performance |
| MOB-02 | HIGH | No native projects; Capacitor installed but unused | Mobile |
| MOB-03 | HIGH | Auth email links/PKCE not mobile-ready | Mobile |
| MOB-04 | HIGH | Camera/MediaPipe untested on devices; native permission setup absent | Mobile |
| SEC-03 | MEDIUM | Raw upstream `error.message` returned to clients (15 sites) | Security |
| SEC-04 | MEDIUM | Weak input validation; prompt interpolation; unvalidated MIME | Security |
| SEC-05 | MEDIUM | No security headers/CSP; no CORS policy | Security |
| FN-03 | MEDIUM | Mirror pose-service init failure caches rejected promise | Master §5 |
| FN-04 | MEDIUM | No exercise recognition in Workout Mirror | Master §5 |
| FN-05 | MEDIUM | Fitness data device-local only; no sync/backup | Master §5 |
| PF-02 | MEDIUM | ~31 MB MediaPipe assets (both WASM variants + model) | Performance |
| MOB-05 | MEDIUM | Web Notification API unreliable in WebViews | Mobile |
| MOB-07 | MEDIUM | No router / hardware back-button handling | Mobile |
| MOB-08 | MEDIUM | localStorage/IndexedDB as sole store in WebView | Mobile |
| TST-01 | MEDIUM | No CI | Tests |
| TST-02 | MEDIUM | `lint` is `tsc` only; no ESLint | Tests |
| TST-03 | MEDIUM | No tests for server.ts, sleep module, AuthContext flows, e2e | Tests |
| SEC-06 | LOW | 4 moderate npm advisories (via `@capacitor/cli`, dev-time) | Security |
| SEC-07 | INFO/MED | Local data unencrypted; scoping is not access control | Security |
| PF-03 | MEDIUM | CPU-only inference, no performance instrumentation | Performance |
| REPO-01 | LOW | 11 `.patch` files + zip in repo root; two lockfiles; boilerplate README; package name `react-example` | Master §5 |

## 5. Findings detailed here (non-security/perf/mobile)

### FN-01 — Exercise Coach calls a non-existent route · HIGH
- **Description:** The client posts to `/api/ai-exercise-coach`; the server only registers `/api/exercise-coach`.
- **Evidence:** `src/components/workouts/WorkoutSessionTracker.tsx:222` vs `server.ts:217`. No other reference to either path.
- **Impact:** The in-workout AI coaching request will return 404. Confirmed by source reading only; not exercised at runtime.
- **Recommended solution:** Align the two paths (one-line change on either side); add a contract test that every `fetch('/api/...')` in `src/` has a matching `app.<method>` in `server.ts`.
- **Dependencies:** None. **Priority:** P0.

### FN-02 — No error boundary · HIGH
- **Evidence:** repo-wide search for `ErrorBoundary` / `componentDidCatch` returns nothing; `App.tsx` mounts `AuthGate` directly.
- **Impact:** An exception in any render (e.g. corrupt localStorage record in a 1,000-line view) unmounts the tree → blank screen. In a native shell the user can only force-quit.
- **Recommended solution:** Top-level and per-tab boundaries with a recovery UI (reload view, export data, reset) and error reporting hook.
- **Dependencies:** Pairs with a monitoring choice (SEC/ops). **Priority:** P0.

### FN-03 — Mirror pose init failure is sticky · MEDIUM
- **Evidence:** `services/workoutMirror/mirrorPoseService.ts` `init()` stores `initPromise` and the `finally` block resets only `isInitializing`; `initPromise` is cleared only in `dispose()` (line ~235). `CameraSetupGuide.tsx` has a "Try Again" button (line ~230) but whether it calls `dispose()` first was not verified. Contrast: the Body Scan loader (`services/poseLandmarker.ts:123`) explicitly supports retry after failure.
- **Impact:** A transient failure (flaky network on first model fetch) may require an app restart. Also: the Mirror loader has no model integrity check, uses `any`, and duplicates ~70% of Body Scan's loader logic.
- **Recommended solution:** Clear `initPromise` on rejection; consolidate both into one shared pose-runtime module using the existing integrity-checked loader.
- **Dependencies:** Before MOB-04 device testing. **Priority:** P1.

### FN-04 — Exercise recognition not implemented · MEDIUM
- **Evidence:** no recognition/classification code in `services/workoutMirror` or `components/workoutMirror` (searched). The user picks from `exerciseCatalog.ts`; seven engines exist (squat, push-up, bicep curl, jumping jack, lunge, plank, shoulder press) with unit tests (`exerciseEngines.test.ts`).
- **Impact:** Feature set differs from the audit brief's "exercise recognition." Rep-counting accuracy on real video is **unverified**; unit tests use synthetic landmark fixtures.
- **Recommended solution:** Decide product scope (manual selection is acceptable); build a recorded-landmark fixture set from real devices to regression-test rep counting.
- **Priority:** P2.

### FN-05 — Fitness data is device-local only · MEDIUM
- **Evidence:** README "Where data lives" (cloud sync "not implemented yet"); `delete_own_account()` comments confirm nothing else is stored server-side; manual export exists (`db.ts` ~828).
- **Impact:** Uninstalling the app, clearing site data, or WebView storage eviction destroys all history. Signing in on a second device shows an empty app.
- **Recommended solution:** Product decision: cloud sync (Supabase tables + RLS) or at minimum scheduled/auto backup via native share/file APIs.
- **Dependencies:** Blocks credible mobile release. **Priority:** P1.

### REPO-01 — Repository hygiene · LOW
- 11 `.patch` files (≈1.6 MB with the zip) and `video-library-source.zip` in the root; `hashes.txt` unexplained; both `bun.lock` and `package-lock.json`; `package.json` name `react-example`; README is the AI Studio template with a banner image.
- **Recommendation:** Move patches to an archive branch/folder or remove from `main` (your decision); keep one lockfile; real README.
