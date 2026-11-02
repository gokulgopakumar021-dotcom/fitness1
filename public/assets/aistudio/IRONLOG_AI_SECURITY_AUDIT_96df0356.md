# IRONLOG AI — Security Audit

Scope: `main` @ `64a816c`. Static review + tooling (`npm audit`). **No live Supabase inspection, no penetration testing, no secret scanning of git history.** No actual secret values are reproduced here. Only `.env.example` is tracked (verified with `git ls-files`), and it contains placeholders.

## Summary

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 1 | SEC-01 |
| HIGH | 1 | SEC-02 |
| MEDIUM | 3 | SEC-03, SEC-04, SEC-05 |
| LOW | 2 | SEC-06, SEC-09 |
| INFORMATIONAL | 2 | SEC-07, SEC-08 (positive controls) |

---

### SEC-01 — Unauthenticated API endpoints (open Gemini proxy) · CRITICAL
- **Description:** The Express server exposes 17 handlers (`/api/extract-plan`, `/generate-plan`, `/exercise-coach`, `/generate-ai-routine`, `/ai-food-parser`, `/ai-workout-insights`, `/ai-plan-overload-tuning`, `/ai-nutrition-coach`, `/ai-recovery-insights`, `/ai-personal-trainer`, `/adaptive-coach/explain`, `/ai-form-analyzer`, `/ai-warmup-generator`, `/ai-generate-physique`, `/ai-physique-analysis`, plus barcode and health) with no authentication or authorisation. Each AI handler builds a `GoogleGenAI` client from the server's `GEMINI_API_KEY`.
- **Evidence:** `server.ts` route list (lines 32–1355); only middleware is `express.json` (line 29). Searches for `getUser`, `bearer`, `authorization`, `jwt`, `cors`, `helmet`, `rate` in `server.ts` return nothing relevant. Supabase auth exists only in the browser (`AuthContext.tsx`); the server never sees or checks a session.
- **Impact:** Anyone who learns the deployment URL can call these endpoints directly, bypassing the sign-in screen, and consume your Gemini quota/billing. Image-bearing endpoints (`extract-plan`, physique) are the most expensive. Publishing a mobile app makes the URL discoverable.
- **Recommended solution:** Require `Authorization: Bearer <Supabase access token>` on all `/api/*` routes except health; verify with Supabase (`auth.getUser(token)` or JWT verification against the project's JWKS) in one Express middleware; attach `req.user.id` for per-user limits (SEC-02).
- **Dependencies:** Client must send the token on every fetch (small shared `apiFetch` wrapper — also required by MOB-01). **Priority:** P0.
- *Caveat:* severity assumes the server is reachable from the public internet. If it is currently reachable only inside AI Studio's preview, exposure is lower today but the fix is still mandatory before mobile.

### SEC-02 — No rate limiting, usage caps; 25 MB body limit on all routes · HIGH
- **Evidence:** `server.ts:29` `express.json({ limit: '25mb' })` applies globally; no limiter library in `package.json`; no per-user counters in any handler.
- **Impact:** Cost amplification and memory pressure (25 MB parsed per request, on routes that need a few hundred bytes). The brief asked about AI Trainer "usage limits": **none exist server-side**.
- **Recommended solution:** Per-route body limits (small default, 25 MB only for `extract-plan`/physique with MIME allow-list); per-user and per-IP rate limits; daily token/request quota keyed to `user.id`; 429 handling in the client.
- **Dependencies:** SEC-01 (identity needed for per-user quotas). **Priority:** P0/P1.

### SEC-03 — Raw `error.message` returned to clients · MEDIUM
- **Evidence:** 15 occurrences of `error?.message` in `server.ts` response paths, e.g. `server.ts:~1355` physique analysis, exercise coach `server.ts:~265`.
- **Impact:** Upstream SDK/API error text (quota, model name, internal URLs) reaches the browser/app.
- **Recommended solution:** Log server-side with a request id; return generic messages plus an error code.
- **Priority:** P2.

### SEC-04 — Weak input validation; prompt interpolation; unvalidated MIME · MEDIUM
- **Evidence:** `exercise-coach` destructures `req.body` and interpolates `exerciseName`, `equipment`, `notes` straight into the prompt with no type/length checks (`server.ts:217–247`). `extract-plan` takes `fileData` and `mimeType` from the body and forwards both to Gemini `inlineData` (`server.ts:38`, `82–90`) with no allow-list or size check beyond the global limit. Only ~8 validation-style checks appear across the 1,691-line file.
- **Impact:** Prompt injection into the coach/trainer prompts (low blast radius since output is advisory text, but it can be used to burn tokens or produce off-policy output); malformed types can throw 500s; arbitrary MIME types forwarded upstream.
- **Recommended solution:** Shared request schema validation (types, max lengths, enum for MIME: pdf/png/jpeg/webp/text), strip/limit user free-text, cap output tokens, validate model JSON before returning (some handlers already do, e.g. adaptive coach `validate.ts`).
- **Dependencies:** None. **Priority:** P1.

### SEC-05 — No security headers / CSP / CORS policy · MEDIUM
- **Evidence:** no `helmet`, `cors`, or header-setting code in `server.ts`; `index.html` has no CSP meta; Google Fonts loaded from a third party.
- **Impact:** Missing clickjacking/MIME-sniff protections and no CSP defence-in-depth. For Capacitor, the app origin (`capacitor://localhost`, `https://localhost`) will be cross-origin to the API, so an explicit, narrow CORS allow-list becomes mandatory.
- **Recommended solution:** `helmet` defaults + a tuned CSP (MediaPipe WASM needs `wasm-unsafe-eval`); explicit CORS allow-list; self-host fonts.
- **Dependencies:** MOB-01 origin decisions. **Priority:** P1.

### SEC-06 — Dependency advisories · LOW
- **Evidence:** `npm audit`: 0 critical, 0 high, **4 moderate** — `@capacitor/cli` (direct, devDependency) and transitive `glob`, `minimatch`, `rimraf`; the tool reports a fix path via `@capacitor/cli`. All are build/CLI-time packages, not shipped in the browser bundle.
- **Recommended solution:** Review and bump `@capacitor/cli` when starting mobile work; re-run audit in CI.
- **Priority:** P3.

### SEC-07 — Local data unencrypted; scoping is not access control · INFORMATIONAL (MEDIUM on mobile)
- **Evidence:** `storage/storageScope.ts` header states scoping "is NOT access control." 58 `localStorage.*` call sites in 17 files; IndexedDB for Body Scan (`bodyScanStore.ts`). Supabase session persisted by default in localStorage (`lib/supabase.ts`, `persistSession: true`).
- **Impact:** Anyone with device/browser-profile access can read health data and the session token. Acceptable for a web app; for a health app on mobile, tokens should live in OS secure storage and sensitive stores should be encrypted or excluded from backups deliberately.
- **Recommended solution:** Decide data classification; use Keychain/Keystore-backed storage for tokens in the native build.
- **Priority:** P2 (mobile phase).

### SEC-08 — Positive controls verified (static) · INFORMATIONAL
- `profiles`: RLS enabled; `revoke all` then grant select + column-level `update (full_name)` only; policies scoped to `auth.uid() = id` (`20261027000000_auth_profiles.sql`).
- `exercise_videos`: RLS; select only where `status='uploaded' and published=true`; writes service-role only (`…010000`, `…28000000`).
- Storage bucket private; object read policy joined to published catalog rows; playback via short-lived signed URLs (`videoCatalogService.ts:153`).
- `delete_own_account()`: `security definer`, `set search_path = ''`, no parameters, execute revoked from `public`/`anon`.
- Frontend refuses service-role/secret keys (`looksLikeSecretKey` in `lib/supabase.ts`). Only publishable-key env vars use `VITE_`; `GEMINI_API_KEY` is read server-side only.
- Body Scan: consent gate before saving; photos saved only on explicit opt-in; camera `audio:false`; CPU-only on-device inference (`camera.ts`, `bodyScanStore.ts`, `poseLandmarker.ts`).
- Repo tests (`rls.profiles`, `rls.exerciseVideos`, `rls.deleteAccount`) run policies in PGlite and pass. **Not verified against the deployed project**: migrations may not match live state.

### SEC-09 — Client logging not fully reviewed · LOW
- 31 `console.*` calls in `src/` (excluding tests). `camera.ts` documents that raw errors are not logged. I did not review each call for personal data.
- **Recommendation:** Add a thin logger that redacts, and a lint rule against raw `console` in production paths.

## Items not assessed
Supabase Auth dashboard settings (email confirmation, redirect allow-list, password policy), storage bucket live configuration, git-history secret scan, file-upload malware handling (no server-side uploads are stored — files are forwarded to Gemini only), Gemini key restrictions in Google Cloud.
