# Remediation Session 1 — IL-01 and IL-02

Date: 3 November 2026
Scope: exactly two findings from the Iron Log Security Audit — Session 1. No other finding was touched.

**Final status: PARTIALLY COMPLETED** — IL-01 fixed and verified locally; IL-02 BLOCKED on a plan upgrade plus a manual dashboard action.

---

## A. Initial state

| Item | Value |
|---|---|
| Branch | `main` |
| Commit | `31fafd333a5515badf2d1b7418e5a948eecba753` ("feat(workout): refactor camera setup and tracking") |
| Remote | `origin/main` at the same commit (fetched, no divergence) |
| Working tree | Clean (`git status --short` empty) |
| Pre-existing unrelated changes | None |

Work was done in a sandbox clone. Nothing was committed, pushed, or deployed. No destructive Git command was used.

---

## B. IL-01 — Internal reports in `public/`

### Files inspected

All eight files in `public/assets/aistudio/` were inspected (first lines and size) and classified. None is referenced by application code, routes, build config, or tests (repo-wide search for the directory name and for every filename hash suffix found no references; the only `aistudio` hit is an unrelated `User-Agent` string in `server.ts`).

| File | Classification |
|---|---|
| `IRONLOG_AI_MASTER_AUDIT_99e0efd8.md` | Internal audit report |
| `IRONLOG_AI_SECURITY_AUDIT_96df0356.md` | Internal security audit |
| `IRONLOG_AI_SECURITY_REMEDIATION_REPORT_78d279a7.md` | Internal remediation report |
| `PHASE1B_STAGE1-4_HANDOVER_c6353c5b.md` | Internal handover notes |
| `IRONLOG_AI_PHASE1B_ORIGINAL_BRIEF_f25fcbdd.md` | Internal working brief |
| `PROPOSED_rls_auto_enable_hardening_24bd92af.sql` | Proposed (unexecuted) SQL hardening script |
| `Paste_November_02__2026_-_7_55PM_912fb3b0` | Pasted working notes (no extension) |
| `Paste_October_30__2026_-_10_48PM_8369f942` | Pasted working notes (no extension) |

### Files moved

All eight were moved with `git mv` to `docs/internal-security/`, keeping their exact filenames. Git reports them as pure renames (0 insertions, 0 deletions), so content is unchanged. `docs/` is not copied by Vite and is not served by Express (the server serves only `dist/`). The now-empty `public/assets/` directory was removed.

### Files retained

None needed to stay public. Rest of `public/` reviewed and left unchanged: `brand/` (17 PNGs), `favicon.ico`, `manifest.webmanifest`, `models/pose_landmarker_full.task` (required by the Workout Mirror/Body Scan), and an empty `models/.gitkeep`.

### Additional public exposure check

Pattern scan of `public/` (excluding the moved directory) for API keys, JWTs, private keys, passwords, Supabase/Gemini references: no matches. No `.env`, `.sql`, `.md`, `.map`, `.log`, or `.bak` files remain. The empty `.gitkeep` is harmless and was left alone.

### Build verification

Commands: `rm -rf dist && npx vite build` → built successfully.

- `dist/assets/` contains no `aistudio` entry.
- `find dist` for names matching `aistudio`, `AUDIT`, `REMEDIATION`, `Paste_*`, `*.md`, `*.sql`, `HANDOVER`: no results.
- `grep -r` of `dist/` for report titles/markers and for all eight filename hash suffixes: no matches.
- Public assets still emitted: 17 brand images, favicon, manifest, pose model.

### Previous-URL verification (production server, local)

Started with `NODE_ENV=production`, in-memory stores, and placeholder (non-secret) Supabase values on port 3112.

- All eight old `/assets/aistudio/<name>` URLs return **HTTP 200 `text/html`, 2,798 bytes, byte-identical to `dist/index.html`** (the SPA fallback `app.get('*')`), with zero document markers. A made-up path returns the same page.
- They return the app shell, **not** a 404 and not the original content. This satisfies "non-document response". Returning a true 404 for unknown `/assets/*` paths would be an optional later improvement and was not changed.
- `/`, `/favicon.ico`, `/manifest.webmanifest`, `/brand/icon-192.png`, `/models/pose_landmarker_full.task` all return 200 with correct content types.
- `/api/health` returns 200; an unauthenticated `POST /api/ai-food-parser` still returns 401.

A first run of this check printed "LEAKS DOC CONTENT" for every URL. That was a false positive from my own search pattern matching the `<title>` of `index.html` ("IRONLOG AI — ..."). The second run compared bodies byte-for-byte and used document-specific markers.

### Important residual exposure (not changed in this session)

**The GitHub repository appears to be public** (an anonymous `git clone` succeeded). Moving the files fixes the deployed website, but the same documents remain readable in the repository at `docs/internal-security/`, in git history, and a similar report exists at the repo root (`IRONLOG_AI_SECURITY_REMEDIATION_REPORT.md`). Options for the owner: make the repository private, and/or decide whether history needs rewriting (destructive, deliberately not done). No secrets were found in these files by pattern scan, but they describe security posture.

---

## C. IL-02 — Supabase leaked-password protection

### Configuration inspected

- `src/utils/authValidation.ts`: `PASSWORD_MIN = 8`, `PASSWORD_MAX = 72` bytes, requires at least one letter and one number. Confirms the audit's eight-character figure. Used by sign-up, password reset, and signed-in password change (`AuthScreens.tsx`, `AccountSecurity.tsx`).
- The app already maps Supabase's `weak_password` error code to a user message, so a rejection from Supabase will display. Its wording ("too weak, try a longer one with letters and numbers") is generic and not specific to leaked passwords; not changed.
- No `supabase/config.toml` exists in the repo, so Auth settings are not version-controlled.
- Existing password requirements were not weakened.

### Status before remediation

Live security advisor (re-run 3 Nov 2026, 05:37 UTC): `auth_leaked_password_protection` — **WARN, "Leaked password protection is currently disabled."**

### Was it enabled?

**No.** Two blockers:

1. **Plan:** the organization is on the **Free** plan (`get_organization`). Supabase's password-security documentation states leaked-password protection is available on the **Pro plan and above**.
2. **Tooling:** the available Supabase tools cannot read or change Auth settings (no Management API tool, no dashboard access, and the sandbox cannot reach the Management API). It cannot be done through SQL.

No setting was changed, and no Auth configuration was modified.

### Manual action required (owner)

1. Supabase Dashboard → Organization → Billing → upgrade the organization to **Pro** (a paid plan; your decision).
2. Open the project → **Authentication** → password settings (labelled "Prevent use of leaked passwords" under the email/password options; the exact menu location varies by dashboard version).
3. Turn it on and save.
4. Re-run the Security Advisor and confirm `auth_leaked_password_protection` no longer appears.
5. Test with a **dedicated throwaway account**: try signing up with a well-known breached password and confirm it is rejected; then sign up with a strong unique password and confirm it works. Verify password reset and signed-in password change the same way. Delete the test user afterwards. Do not reuse a real account or real password.
6. Optional: consider raising the minimum length in the same settings page. Not required by this finding.

### Verification

NOT VERIFIED. Cannot verify an enabled state that does not exist. No test accounts were created and no live sign-up, login, reset, or password-change flow was exercised.

---

## D. Regression results

| Check | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `npx tsc --noEmit` exit 0 |
| Tests | PARTIAL | 1 failed, 2,601 passed, 36 skipped (137 files passed, 1 failed, 2 skipped). **Identical to the pre-change baseline.** The one failure is the pre-existing IL-06 (`poseLandmarker.privacy.test.ts`, line 209), untouched |
| Production build | PASS | `vite build` succeeded after `rm -rf dist` |
| Public asset scan | PASS | No internal files, report content, or hash stems in `dist/`; brand, manifest, favicon, model present |
| Previous URL checks | PASS | 8/8 old URLs return the SPA shell (200, identical to `index.html`), no document content |
| Reference search | PASS | No code, config, or test referenced the moved files |
| Supabase leaked-password protection | NOT VERIFIED | Advisor still reports it disabled; Free plan; no Auth-config tool |

---

## E. Git changes (all mine; there were no pre-existing changes)

Staged by `git mv`, not committed:

| Status | From | To |
|---|---|---|
| Renamed | `public/assets/aistudio/IRONLOG_AI_MASTER_AUDIT_99e0efd8.md` | `docs/internal-security/IRONLOG_AI_MASTER_AUDIT_99e0efd8.md` |
| Renamed | `public/assets/aistudio/IRONLOG_AI_PHASE1B_ORIGINAL_BRIEF_f25fcbdd.md` | `docs/internal-security/IRONLOG_AI_PHASE1B_ORIGINAL_BRIEF_f25fcbdd.md` |
| Renamed | `public/assets/aistudio/IRONLOG_AI_SECURITY_AUDIT_96df0356.md` | `docs/internal-security/IRONLOG_AI_SECURITY_AUDIT_96df0356.md` |
| Renamed | `public/assets/aistudio/IRONLOG_AI_SECURITY_REMEDIATION_REPORT_78d279a7.md` | `docs/internal-security/IRONLOG_AI_SECURITY_REMEDIATION_REPORT_78d279a7.md` |
| Renamed | `public/assets/aistudio/PHASE1B_STAGE1-4_HANDOVER_c6353c5b.md` | `docs/internal-security/PHASE1B_STAGE1-4_HANDOVER_c6353c5b.md` |
| Renamed | `public/assets/aistudio/PROPOSED_rls_auto_enable_hardening_24bd92af.sql` | `docs/internal-security/PROPOSED_rls_auto_enable_hardening_24bd92af.sql` |
| Renamed | `public/assets/aistudio/Paste_November_02__2026_-_7_55PM_912fb3b0` | `docs/internal-security/Paste_November_02__2026_-_7_55PM_912fb3b0` |
| Renamed | `public/assets/aistudio/Paste_October_30__2026_-_10_48PM_8369f942` | `docs/internal-security/Paste_October_30__2026_-_10_48PM_8369f942` |
| Added (untracked) | — | `docs/internal-security/REMEDIATION_SESSION_1.md` (this file) |

No source code, configuration, dependency, migration, or database change. Live Supabase: read-only queries and advisors only.

---

## F. Remaining findings

Untouched in this session: IL-03 (unscoped hydration/unit localStorage keys), IL-04 (`consume_ai_quota` bucket abuse), IL-05 (Capacitor CLI dev advisories), IL-06 (stale privacy test), IL-07 through IL-10, and all mobile-readiness gaps. The overall release decision (CONDITIONALLY READY, web only) is unchanged. This session does not make the application "fully secure".

New observation for the register (not remediated): public GitHub repository exposure described in section B.

---

## G. Final status

**PARTIALLY COMPLETED.**

- IL-01: fixed and verified locally. Not deployed, so the live site must still be redeployed and the old URLs re-checked there.
- IL-02: BLOCKED. Requires Pro plan, then a manual dashboard toggle, then verification.
