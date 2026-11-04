/**
 * Vercel rewrite URL normalisation (Stage 3.5).
 *
 * `vercel.json` rewrites `/api/:__ironlog_api_path*` to the single function `/api`. Because the destination does not
 * use the named parameter, Vercel appends it to the query string. Stage 1 observed that `req.url` keeps the ORIGINAL
 * path (`/api/__vercel_spike/path?path=__vercel_spike%2Fpath`), so only the query needs cleaning. The injected
 * parameter carries nothing Express needs, and leaving it in `req.url` would make it visible in `req.query`,
 * `req.originalUrl` and logs.
 *
 * The parameter has a RESERVED name that no client has a reason to send, so the rule is simple and deterministic:
 * remove EVERY occurrence of that key from the query string, and change nothing else. Specifically:
 *  - a client's own `path` parameter (single, repeated, or alongside the reserved key) is never touched;
 *  - all other parameters keep their order, repetition, raw encoding and empty segments, byte for byte
 *    (no parse/re-serialise, so `%2F`, `+`, `%20`, `[]` and similar survive exactly);
 *  - the path part (including encoded characters such as `%2F` in a barcode) is never modified;
 *  - the key is compared after percent-decoding, so `%5F%5Fironlog_api_path=x` cannot smuggle the reserved key past
 *    the filter (Express would decode it to the same name);
 *  - a malformed escape in a key means the key cannot equal the reserved name, so that segment is kept as is.
 *
 * Pure function: no I/O, no environment, no timers. Method and body are not its concern and are never touched.
 */

/** Must match the parameter name in the `vercel.json` rewrite source (a test enforces this). */
export const RESERVED_REWRITE_PARAM = '__ironlog_api_path';

function keyOf(segment: string): string | undefined {
  const eq = segment.indexOf('=');
  const rawKey = eq === -1 ? segment : segment.slice(0, eq);
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    return undefined;
  }
}

/** Returns `url` without any occurrence of the reserved rewrite parameter. Returns the SAME string when there is none. */
export function normalizeRewrittenUrl(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return url;
  const pathPart = url.slice(0, q);
  const query = url.slice(q + 1);

  const segments = query.split('&');
  const kept = segments.filter((segment) => keyOf(segment) !== RESERVED_REWRITE_PARAM);
  if (kept.length === segments.length) return url; // nothing to remove: byte-identical, no allocation of a new URL

  const rest = kept.join('&');
  return rest === '' ? pathPart : `${pathPart}?${rest}`;
}
