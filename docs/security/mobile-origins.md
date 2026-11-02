# CORS and native (Capacitor) origins

Web: the API allows an origin only if it is in `CORS_ALLOWED_ORIGINS` (plus `APP_URL` / `VITE_SITE_URL`), or if it has the
same host as the server (production deployments that serve the SPA and API together need no entry). Development adds
`http://localhost:3000|5173|8080`. There is no wildcard and no `Access-Control-Allow-Credentials`: the API authenticates
with an `Authorization: Bearer` header, never cookies.

Native (not enabled yet; opt in when the Capacitor build exists):

1. Set `CORS_ALLOW_CAPACITOR=true`. This adds `capacitor://localhost` (iOS), `https://localhost` (Android default,
   `androidScheme: https`) and `http://localhost`. Check `capacitor.config.ts` before relying on this: if the scheme or
   hostname is customised, list the real origin in `CORS_ALLOWED_ORIGINS` instead and leave the flag off.
2. Build the native bundle with `VITE_API_BASE_URL=https://<api-host>` so `apiFetch` calls the remote API and attaches
   the token only to that origin.
3. `http://localhost` is only needed for live-reload development; drop it from production configuration by listing the
   exact origins instead of using the flag.
4. A native WebView origin is a convenience boundary, not a secret: real access control is the Supabase token plus
   per-user limits and quotas. Do not treat the CORS allow-list as authentication.
