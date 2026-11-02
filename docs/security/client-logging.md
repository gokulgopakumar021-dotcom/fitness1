# Client logging (browser / Capacitor webview)

All client diagnostics go through `src/lib/clientLog.ts` (`logClientError`, `logClientWarn`). Raw `console.*` under
`src/` is blocked by a guard test (`src/lib/clientLog.test.ts`); the only exemptions are the logger itself, the server
logger (`src/server/security/logger.ts`, which has its own redaction) and the Redis test harness.

## Behaviour

| Mode | Output |
|---|---|
| Production (`import.meta.env.DEV` false) | `[ironlog] <static scope>` plus `{ name, code? }` only. `name`/`code` must match `[A-Za-z0-9_.-]{1,64}` (numeric `code` 0 is dropped), otherwise `name` becomes `Error`. Never `message`, `stack`, `cause`, other properties, strings or objects passed as the error. |
| Development | `[ironlog] <scope>` plus the full error object, so local debugging is unchanged. |

## Why

Error objects here can carry sensitive text: `JSON.parse` failures quote the beginning of the stored record (profile,
nutrition, body metrics, sleep), AI/fetch failures can carry response text, camera/Bluetooth errors can carry device
detail. Console output reaches remote-debug sessions, bug reports and native logs.

## Rules for new code

- `scope` is a fixed string literal. Never interpolate user data, ids, barcodes, file names, prompts or tokens into it.
- Pass only caught errors as the second argument, never user data.
- Do not add `console.*`; the guard test fails the suite.
- Messages shown to the user (`setError(err.message)` etc.) are a separate UX concern and are not changed by the logger.

## Not covered

`server.ts` has two startup `console` calls (listening address; a refusal-to-start message built from the config
problem text, which names settings, not values). Request logging on the server uses `src/server/security/logger.ts`.
