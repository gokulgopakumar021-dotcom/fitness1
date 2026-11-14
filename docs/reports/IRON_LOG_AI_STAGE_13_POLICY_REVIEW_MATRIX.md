# Iron Log AI — Stage 13 Policy Review Matrix

Statuses: **DONE**, **OPEN**, **BLOCKED**, **UNKNOWN**. "Evidence" is where the statement was checked on 2026-11-14. No policy is legally approved.

## Privacy Policy (`/privacy`)
| Topic | Policy says | Implementation evidence | Finding | Status |
|---|---|---|---|---|
| Local vs cloud split | Profile, nutrition, body metrics, sleep, Body Scan device-only; workout plans/sessions synced | Table of storage in policy; sync migrations; no sync of the others found | Consistent | DONE |
| Body Scan | Photos, measurements, consent on device only; optional save | No `fetch`/`rpc`/Supabase call in `src/components/bodyscan`; `poseLandmarker.privacy.test.ts`; consent screen text | Consistent | DONE (device and browser tests not repeated) |
| AI processing | Text and context sent to Gemini; no content stored in DB; usage counters only | `src/server/app.ts` routes; `/api/extract-plan` sends PDF/image/text/CSV up to 14 MB; physique routes text-only | Consistent. Plan-import images could contain anything the user chooses | DONE |
| Gemini terms | Not stated; no training denial | Tier unknown | Owner must supply | BLOCKED |
| Payments | Razorpay; records kept after deletion | `billing` code; deletion migration | Consistent; retention period missing | BLOCKED |
| Analytics / cookies | None; local storage, IndexedDB, Razorpay cookies, Google Fonts | No analytics package or script found; `index.html` loads Google Fonts | Consistent | DONE |
| Support communications | Added in Stage 13 | support@ mailbox | Retention not set | OPEN |
| Acceptance and 18+ records | Added to table and deletion list in Stage 13 | `on delete cascade` in both migrations; test added | Consistent; counsel to decide whether to retain a minimal record | OPEN (lawyer) |
| Supabase region | Review note updated | Project listing: ap-northeast-1 | Verified read-only | DONE |
| Vercel logs, Upstash, backups | "not verified" | Not readable from repo | Owner | UNKNOWN |
| Breach / incident handling | Review note only | No process | Lawyer and owner | OPEN |
| DPDP / IT Act | Explicitly no compliance claim | — | Lawyer | OPEN |

## Terms (`/terms`)
| Topic | Finding | Status |
|---|---|---|
| Eligibility 18+ and self-declaration | Present, no verification claim (test) | DONE |
| Account security and responsibilities | Present | DONE |
| Prices ₹299 / ₹1,499, no tax added | Present; equals code defaults (test); live values unread | DONE text / UNKNOWN live |
| Three-day trial | Added in Stage 13 ("currently three days"); billing behaviour unverified | DONE text / BLOCKED on Stage 12 |
| Trial authorisation, ₹5 debit, renewal | Present; refund of ₹5 deferred to Refund Policy | DONE text |
| Payment failure | Only implied (cancellation and availability sections) | OPEN (lawyer to say if a dedicated clause is needed) |
| AI, fitness, medical and emergency disclaimers | Present, no diagnosis or guaranteed results | DONE |
| Body Scan limits | Added in Stage 13 (adults only, device-based, no body-fat estimate, not clinical) | DONE |
| IP, third parties, acceptable use, termination, deletion | Present | DONE |
| Liability | Statutory rights preserved; three-month cap is a placeholder | OPEN (lawyer) |
| Governing law, venue, grievance | Placeholders | BLOCKED |
| Operator identity | Placeholder | BLOCKED |

## Refund Policy (`/refund-policy`)
| Topic | Finding | Status |
|---|---|---|
| Duplicates, incorrect charges, verified billing errors only; no change-of-mind | Present, matches owner decision (test) | DONE |
| Statutory rights preserved | Present | DONE |
| No fixed processing time, no automatic-refund promise, ₹5 not promised returned | Present (test) | DONE |
| Process and information to include | Present | DONE |
| Provider-dependent behaviour | Review note remains | BLOCKED on Stage 12 |

## Cancellation Policy (`/cancellation-policy`)
| Scenario | Code behaviour (`service.ts` cancel, `buildSyncPatch`) | Page says | Status |
|---|---|---|---|
| During trial | Cancelled at Razorpay now; access until trial end | Same | DONE text; Razorpay behaviour unverified |
| Active paid plan | Cancel at cycle end; access until period end | Same | DONE text; unverified |
| Pending / failed / halted | Billing stops; no access to keep | "other states" wording | DONE text |
| Immediate cancellation | Only on account deletion (no refund of current period) | Said | DONE text |
| Refund on cancel | None automatic | Not promised | DONE |
| Expired | Row terminal | Not separately described | OPEN (minor) |

## Contact (`/contact`)
| Item | Finding | Status |
|---|---|---|
| Brand and support email | Correct; no telephone, address or registration shown (test) | DONE |
| Not called a registered company | States individual, not company (test) | DONE |
| Operator name, address, grievance contact | Placeholders | BLOCKED |

## Age declaration and acceptance
| Check | Evidence | Status |
|---|---|---|
| Both checkboxes unchecked by default | `AuthScreens.tsx`: `useState(false)` for both | DONE |
| Signup blocked without both | `submit` returns on either error; DB trigger rejects missing versions | DONE |
| Self-declaration wording | Terms and Privacy; test forbids verification claims | DONE |
| Existing accounts get a one-time declaration | `declare_adult_18_plus`, method `existing_user_gate` | DONE (UI flow tests exist; not re-run in a browser) |
| Body Scan gated at 18+ | `getBodyScanGate` with database status; fails safe when unavailable | DONE (client-side; feature has no API) |
| API-level age enforcement | Code exists; `AGE_ENFORCEMENT` unset in production (Stage 10 report) | OPEN — owner decision, not changed |
| Hosted functions | Read-only: all four are SECURITY DEFINER, `search_path=""`, execute for authenticated and service_role only | DONE |
| Hosted version allowlist | `legal_policy_versions` = terms and privacy `2026-11-draft-1`, current | DONE |

## Existing-user policy update notice
| Check | Evidence | Status |
|---|---|---|
| Users on old versions identified | `fetchPolicyNoticeStatus` looks for a row with exactly the current pair | DONE |
| New version re-triggers | Version pair comparison; tests | DONE |
| Documents viewable | Links open `/terms` and `/privacy` | DONE |
| Acceptance recorded with version and DB time | `acknowledge_legal_update` validates versions, DB clock, method `existing_user_notice` | DONE |
| Explicit acceptance | Button says "I've read the updates"; copy says it records that they were *seen* | OPEN — weaker than explicit agreement |
| Cannot bypass | "Remind me later" hides it for the session; unknown status never shows it; non-blocking | OPEN — documented, not changed (owner and lawyer decision) |
| Not silently treated as accepted | No automatic recording | DONE |

## Versioning and release gate
| Check | Evidence | Status |
|---|---|---|
| Labels consistent (config, pages, migration seed, hosted allowlist) | `2026-11-draft-1` everywhere; existing seed-consistency test | DONE |
| New migration needed | None: no schema or allowlist change in Stage 13 | DONE |
| `LEGAL.isDraft` true; effective date null | `legalConfig.ts`; tests | DONE |
| Gate blocks premature release | `releaseBlockers` rejects missing date, draft labels, draft language, invented facts | DONE (suite results in the report) |
| Final labels and migration | Await owner information and lawyer review | BLOCKED |
