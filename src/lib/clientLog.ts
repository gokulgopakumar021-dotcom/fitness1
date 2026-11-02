/**
 * Client-side logging with redaction. Every browser/webview diagnostic goes through here instead of raw `console.*`
 * (a guard test in clientLog.test.ts fails if a raw console call is added under `src/`).
 *
 * Why: error objects in this app can carry personal or sensitive text. `JSON.parse` failures quote the start of the
 * stored record (profile, nutrition, body metrics, sleep), fetch/AI failures can carry server response text, camera and
 * Bluetooth errors can carry device details. Console output ends up in remote-debugging sessions, bug reports and
 * native log streams, so none of that is written in production.
 *
 * Production (`import.meta.env.DEV` false): a static scope plus a safe summary only: the error's `name` and a short
 * `code`, each limited to a conservative character set. Never `message`, `stack`, `cause`, request/response bodies,
 * tokens, prompts, file metadata or storage keys.
 * Development: the full error object is passed through so local debugging keeps its detail.
 *
 * Rules for callers: `scope` must be a fixed string literal (never built from user data); do not pass user data as
 * the second argument, only caught errors.
 */

export interface SafeErrorSummary {
  name: string;
  code?: string | number;
}

const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;

/** Reduces anything thrown to `{ name, code? }`. Never includes message, stack, cause or other properties. */
export function summarizeError(err: unknown): SafeErrorSummary {
  if (err === null || typeof err !== 'object') return { name: 'NonError' };
  const rec = err as { name?: unknown; code?: unknown };
  const name = typeof rec.name === 'string' && SAFE_TOKEN.test(rec.name) ? rec.name : 'Error';
  const summary: SafeErrorSummary = { name };
  if (typeof rec.code === 'number' && Number.isFinite(rec.code) && rec.code !== 0) summary.code = rec.code; // 0 = legacy DOMException default
  else if (typeof rec.code === 'string' && SAFE_TOKEN.test(rec.code)) summary.code = rec.code;
  return summary;
}

function emit(level: 'warn' | 'error', scope: string, err: unknown, hasErr: boolean): void {
  const tag = `[ironlog] ${scope}`;
  // Read at call time so tests can stub it.
  if (import.meta.env.DEV) {
    if (hasErr) console[level](tag, err);
    else console[level](tag);
    return;
  }
  if (hasErr) console[level](tag, summarizeError(err));
  else console[level](tag);
}

export function logClientWarn(scope: string, ...err: [unknown?]): void {
  emit('warn', scope, err[0], err.length > 0);
}

export function logClientError(scope: string, ...err: [unknown?]): void {
  emit('error', scope, err[0], err.length > 0);
}
