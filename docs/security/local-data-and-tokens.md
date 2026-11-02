# Local data and token storage (SEC-07 preparation)

Documentation only. Nothing in this phase changes the storage architecture. Based on the audit and a read of
`src/storage/db.ts`, `src/lib/supabase.ts` and `src/lib/apiFetch.ts`; counts come from the audit (58 `localStorage` call
sites in 17 files; IndexedDB for Body Scan) and have not been re-counted.

## Where the authentication token lives
- Supabase session (access + refresh token): `persistSession: true` in `src/lib/supabase.ts`, so supabase-js keeps it in
  browser `localStorage` under its default per-project key. This is why web sessions survive reloads.
- `apiFetch` reads the session through `supabase.auth.getSession()` on each call. It stores nothing itself and does not
  change how the session persists.

## Sensitive local data (by what `db.ts` reads/writes)
Profile (body weight, height, goals), workout plans and sessions, active session, nutrition logs, custom foods, body
metrics, sleep logs, uploaded plan documents, AI recommendations, Body Scan consent flag, and Body Scan photos/landmarks
(IndexedDB, saved only on explicit opt-in). All are health-related; Body Scan photos and body metrics are the most sensitive.

## Needs protection at rest in native apps
- Tokens: must move out of WebView `localStorage`.
- Body Scan photos and body metrics: encrypt at rest or keep in app-private storage excluded from backup.
- The rest: OS app sandbox is acceptable, but decide deliberately whether it may be included in device backups.

## Future token approach (not implemented, no dependency added)
Provide a custom `storage` adapter to `createClient({ auth: { storage } })` backed by a Keychain (iOS) / Android Keystore
backed Capacitor plugin. Choose and vet the plugin when the Capacitor phase starts; do not add one before then.

## Backup and export implications
- iOS iCloud/iTunes and Android Auto Backup can copy app-private files and WebView storage unless excluded
  (`android:allowBackup`/backup rules, iOS "do not back up" attribute). Decide per data class.
- The account-deletion RPC removes server data only; local data is cleared by the client. Any future export feature must
  not include tokens.
