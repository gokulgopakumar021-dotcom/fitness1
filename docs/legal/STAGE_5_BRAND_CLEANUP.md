# Iron Log AI: Stage 5 brand and metadata cleanup (Stage 2D)

Owner decision: the public brand is **Iron Log AI** (three words, title case).

## What changed
- App text, notification titles, error and consent copy, page `<title>`, Open Graph/Twitter tags, `application-name`, the Apple web-app title, `public/manifest.webmanifest` (`name` and `short_name`), the Capacitor `appName`, `metadata.json` and the README now say "Iron Log AI".
- `src/brand.ts` is the single source of truth. `BRAND.name`, `proseName` and `shortName` are "Iron Log AI"; new `BRAND.wordmark` is "IRON LOG AI" for styled capitals (landing/navbar wordmark, page eyebrows, footer line). It is the same spelling, only in capitals.
- Code comments that used the old spellings were updated so the drift guard needs no exceptions beyond the two below.
- `accepted_at_client`: already removed from the sign-up payload in Stage 1. Stage 5 adds a guard that fails if it returns. Timestamps come only from the database clock.

## Deliberately NOT changed
| Item | Why |
|---|---|
| `ironlog_*` localStorage/IndexedDB keys, `ironlog.app` domain, `support@ironlog.app`, `ironlog-*` file names, `[ironlog]` log tag, Redis key prefix | Internal identifiers. Renaming would orphan existing user data or break the approved support address. |
| `app: 'IRONLOG AI'` in the backup export (`src/storage/db.ts`) | File-format marker already present in users' exported backups. The importer does not read it, but changing it gains nothing and could confuse older files. |
| `User-Agent: IronLog-FitnessOS/1.0` (`src/server/app.ts`) | Technical identifier sent to an external API, not public brand copy. |
| `server.ts` startup/refusal log lines | Operator logs, not customer-facing. |
| Historical reports (`docs/internal-security/**`, `docs/deployment/**`, `docs/VERCEL_*`, `IRONLOG_AI_SECURITY_REMEDIATION_REPORT.md`) | Dated records of earlier work; rewriting history would be misleading. |
| Logo image files in `public/brand/` (and `og-image.png`, icons, splash) | Image artwork, not editable in code. See below. |

## Open item for the owner: logo artwork
The wordmark image (`public/brand/ironlog-ai-wordmark-transparent.png`) shows the one-word form "IRONLOG AI". The `og-image.png` share card, icons and splash were produced from the same artwork. Until new artwork is supplied, the logo image and the "Iron Log AI" text will differ in the word spacing. Options: (a) commission or export a "IRON LOG AI" version of the logo and replace the files, (b) accept the logo as a stylised mark. Not a code change, so left for the owner.

## Guard
`src/test/brandConsistency.test.ts` fails if a one-word spelling appears in app source, page metadata, the manifest, the Capacitor config, `metadata.json` or the README (apart from the two technical identifiers above), if the legal brand name and `BRAND` ever differ, or if `accepted_at_client` returns.
