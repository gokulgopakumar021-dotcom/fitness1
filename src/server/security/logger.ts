/**
 * Minimal structured logger with redaction. One JSON object per line, written through console.* so existing
 * log collection keeps working. Never pass request bodies, health data, uploaded content or tokens as fields;
 * redaction is a safety net, not permission.
 */
const SENSITIVE_KEY = /token|authorization|password|passwd|secret|api[-_]?key|cookie|bearer|jwt/i;
const MAX_STRING = 500;

const JWT_LIKE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const GOOGLE_KEY = /AIza[0-9A-Za-z_-]{20,}/g;
// Razorpay authenticates with HTTP Basic (key_id:key_secret). Base64 of that pair is the secret, so a stray header echo must not survive.
const BASIC = /Basic\s+[A-Za-z0-9+/]{16,}={0,2}/g;
const RZP_KEY_ID = /rzp_(?:test|live)_[A-Za-z0-9]{6,}/g;
const SB_KEY = /sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g;
const URL_QUERY_KEY = /([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+/gi;

export function scrubString(value: string): string {
  const cleaned = value
    .replace(JWT_LIKE, '[redacted-jwt]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(BASIC, 'Basic [redacted]')
    .replace(RZP_KEY_ID, '[redacted-key]')
    .replace(GOOGLE_KEY, '[redacted-key]')
    .replace(SB_KEY, '[redacted-key]')
    .replace(URL_QUERY_KEY, '$1[redacted]');
  return cleaned.length > MAX_STRING ? `${cleaned.slice(0, MAX_STRING)}…[truncated]` : cleaned;
}

export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object') return value;
  if (depth > 4) return '[depth-limit]';
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const status = (err as { status?: unknown }).status;
    return {
      name: err.name,
      message: scrubString(err.message),
      ...(typeof status === 'number' ? { status } : {}),
      stack: err.stack ? scrubString(err.stack.split('\n').slice(0, 6).join('\n')) : undefined
    };
  }
  return { message: scrubString(String(err)) };
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')).toLowerCase();
  return ORDER[(raw as Level)] ?? ORDER.info;
}

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields ?? {}) as object) });
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(line);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => emit('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields)
};
