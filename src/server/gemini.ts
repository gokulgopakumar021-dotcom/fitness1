import { GoogleGenAI, type GoogleGenAIOptions } from '@google/genai';
import { logger } from './security/logger';

/**
 * Gemini client factory: a hard upper bound on every model call (Stage 3.8, owner decision: 90 s) plus a one-shot,
 * model-level fallback when the primary model reports capacity trouble (HTTP 503 / UNAVAILABLE).
 *
 * Retry behaviour (verified against the installed `@google/genai` 2.31.0, `apiCall`): when `httpOptions.retryOptions`
 * is NOT set, the SDK performs exactly one HTTP request and throws an `ApiError` (numeric `status`) on failure. There is
 * no retry and no back-off. Retrying only turns on when `retryOptions` is set (then 5 attempts with exponential
 * back-off on 408/429/500/502/503/504). This factory never sets `retryOptions`, so the SDK makes one attempt per model.
 *
 * Deadline: every `generateContent` call gets ONE AbortController and ONE timer that fire after `timeoutMs` for the
 * WHOLE call (the primary attempt and the fallback attempt share it; the fallback never gets a fresh 90 s). The abort
 * rejects with an `AbortError`, which `classifyError` already maps to the fixed `504 upstream_timeout` response (no
 * provider text is ever forwarded). The timer is cleared and the caller-signal listener removed when the call settles,
 * so nothing keeps an invocation alive. A caller-supplied `abortSignal` is still honoured.
 *
 * Fallback: only a primary failure with `status === 503` or `'UNAVAILABLE'` triggers one more request, to the fallback
 * model, with identical parameters except `model`. 400/401/403/404/408/429/500/502/504, aborts and timeouts are rethrown
 * unchanged (429 is excluded because both models share one project quota). The fallback is skipped when the shared
 * controller is already aborted, when it is disabled, when the requested model already is the fallback, or when less
 * than `minRemainingMs` of the deadline is left. Worst case: 2 HTTP requests per generation. If the fallback also fails,
 * its error is rethrown and the existing sanitized classification applies unchanged.
 *
 * Configuration (server-side only, never a `VITE_` variable): `GEMINI_FALLBACK_MODEL`
 *   unset / empty -> `gemini-3.6-flash`;  `off` -> disabled;  invalid model id -> disabled + one sanitized warning.
 *
 * The overall deadline must stay below the Vercel function `maxDuration` (120 s, vercel.json) so the route can answer.
 */
export const GEMINI_TIMEOUT_MS = 90_000;
export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.6-flash';
/** Do not start the fallback attempt with less than this much of the shared deadline left. */
export const GEMINI_FALLBACK_MIN_REMAINING_MS = 10_000;

const MODEL_ID = /^gemini-[a-z0-9][a-z0-9.\-]*$/;
let warnedInvalidFallback = false;

/**
 * Resolves the raw `GEMINI_FALLBACK_MODEL` value to a model id, or `null` when the fallback is disabled.
 * An invalid value disables the fallback (primary behaviour unchanged) and logs one warning per process that never
 * includes the configured value.
 */
export function resolveFallbackModel(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return DEFAULT_GEMINI_FALLBACK_MODEL;
  if (value.toLowerCase() === 'off') return null;
  if (MODEL_ID.test(value)) return value;
  if (!warnedInvalidFallback) {
    warnedInvalidFallback = true;
    logger.warn('gemini_fallback_config_invalid', { reason: 'GEMINI_FALLBACK_MODEL is not a valid model id; fallback disabled' });
  }
  return null;
}

export interface GenAIWrapperOptions {
  /** Raw fallback setting (same grammar as `GEMINI_FALLBACK_MODEL`). Defaults to the environment variable. */
  fallbackModel?: string;
  /** Minimum deadline left for a fallback attempt to start. Defaults to 10 s; lowered in tests only. */
  minRemainingMs?: number;
}

const normalizeModel = (m: unknown): string => String(m ?? '').replace(/^models\//, '');

function isUnavailable(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 503 || status === 'UNAVAILABLE';
}

export function createGenAI(
  options: GoogleGenAIOptions,
  timeoutMs: number = GEMINI_TIMEOUT_MS,
  wrapperOptions: GenAIWrapperOptions = {}
): GoogleGenAI {
  const ai = new GoogleGenAI({ ...options, httpOptions: { ...options.httpOptions, timeout: timeoutMs } });
  const models = ai.models;
  const generate = models.generateContent.bind(models);
  const fallbackModel = resolveFallbackModel(wrapperOptions.fallbackModel ?? process.env.GEMINI_FALLBACK_MODEL);
  const minRemainingMs = wrapperOptions.minRemainingMs ?? GEMINI_FALLBACK_MIN_REMAINING_MS;

  models.generateContent = (async (params: Parameters<typeof generate>[0]) => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const callerSignal = params.config?.abortSignal;
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
    try {
      try {
        return await generate({ ...params, config: { ...params.config, abortSignal: controller.signal } });
      } catch (primaryError) {
        if (!isUnavailable(primaryError)) throw primaryError;
        if (!fallbackModel || normalizeModel(params.model) === fallbackModel) throw primaryError;
        const remainingMs = timeoutMs - (Date.now() - startedAt);
        if (controller.signal.aborted || remainingMs < minRemainingMs) throw primaryError;

        logger.warn('gemini_fallback', {
          from: normalizeModel(params.model),
          to: fallbackModel,
          status: (primaryError as { status?: unknown }).status
        });
        const callerTimeout = params.config?.httpOptions?.timeout;
        return await generate({
          ...params,
          model: fallbackModel,
          config: {
            ...params.config,
            abortSignal: controller.signal,
            // Transport only: keep the SDK's X-Server-Timeout header in line with what is really left of the deadline.
            httpOptions: { ...params.config?.httpOptions, timeout: Math.min(remainingMs, callerTimeout ?? remainingMs) }
          }
        });
      }
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }) as typeof models.generateContent;

  return ai;
}
