import { randomUUID } from 'node:crypto';
import { GoogleGenAI, type GoogleGenAIOptions } from '@google/genai';
import { logger } from './security/logger';

/**
 * Gemini client factory: a hard upper bound on every model call (Stage 3.8, owner decision: 90 s) plus a bounded,
 * centralized recovery sequence when the model reports capacity trouble (HTTP 503 / UNAVAILABLE).
 *
 * SDK behaviour (verified against the installed `@google/genai` 2.31.0, `apiCall`): when `httpOptions.retryOptions`
 * is NOT set, the SDK performs exactly one HTTP request and throws an `ApiError` (numeric `status`) on failure. There is
 * no retry and no back-off. This factory never sets `retryOptions`, so every HTTP attempt below is made by this file
 * and is counted here; nothing else retries underneath it.
 *
 * Recovery sequence (503 / UNAVAILABLE only), at most GEMINI_MAX_ATTEMPTS = 3 HTTP requests per generation:
 *   1. primary model;
 *   2. on 503: wait a jittered back-off (1-2 s), then retry the primary ONCE;
 *   3. on a second 503: ONE request to the fallback model (identical parameters except `model`; never retried).
 * 400/401/403/404/408/429/500/502/504, network errors, aborts and timeouts are rethrown unchanged at any step, and a
 * successful response is returned immediately (nothing is ever started after a success, so no duplicate generation).
 * If every attempt fails, the last error is rethrown and the existing sanitized classification (`classifyError`) applies.
 *
 * Back-off: delay = min(GEMINI_RETRY_MAX_DELAY_MS, GEMINI_RETRY_BASE_DELAY_MS * 2^retryIndex * (1 + jitter)), jitter in
 * [0, 1). Only one retry exists, so retryIndex is 0 and the delay is 1.0-2.0 s; the total delay of a generation can
 * never exceed GEMINI_RETRY_MAX_DELAY_MS. There is no delay before the fallback (a different model; waiting would only
 * burn the user's time).
 *
 * Deadline: every `generateContent` call gets ONE AbortController and ONE timer that fire after `timeoutMs` for the
 * WHOLE call (all attempts and the back-off share it; nothing gets a fresh 90 s). The abort rejects with an
 * `AbortError`, which `classifyError` already maps to the fixed `504 upstream_timeout` response (no provider text is
 * ever forwarded). The back-off wait is abortable by the same controller. The timer is cleared and the caller-signal
 * listener removed when the call settles. A caller-supplied `abortSignal` is still honoured at every step.
 *
 * Time guard: a retry is not started (and its delay is not waited) unless `minRemainingMs` (10 s) would still remain
 * after the delay; the fallback is not started with less than `minRemainingMs` left. In either case the last 503 is
 * rethrown unchanged. Each later attempt advertises only the time that is really left (X-Server-Timeout).
 *
 * Logging (structured, no prompts, history, user content, keys, tokens or provider message bodies; only the
 * generation id, model ids, attempt numbers, numeric statuses, outcome and elapsed time):
 *   `gemini_retry`              warn  a 503 triggered a retry of the primary (attempt = the one that failed, delayMs)
 *   `gemini_retry_succeeded`    info  the primary retry succeeded
 *   `gemini_fallback`           warn  a second 503 triggered the fallback model (kept from the previous version)
 *   `gemini_fallback_succeeded` info  the fallback model answered
 *   `gemini_recovery_failed`    warn  recovery ended without a response (reason, attempts, models, statuses, elapsedMs)
 * A first-attempt success, and a first-attempt failure that is not a 503, log nothing here (the route logs those).
 *
 * Configuration (server-side only, never a `VITE_` variable): `GEMINI_FALLBACK_MODEL`
 *   unset / empty -> `gemini-3.5-flash-lite`;  `off` -> disabled;  invalid model id -> disabled + one sanitized warning.
 *
 * The overall deadline must stay below the Vercel function `maxDuration` (120 s, vercel.json) so the route can answer.
 */
export const GEMINI_TIMEOUT_MS = 90_000;
/**
 * Default fallback: a different (Flash-Lite) family than the primary, so it is more likely to have capacity when the
 * primary Flash family is overloaded (a same-family fallback was 503 at the same moment in production). Stable per Google's
 * model list; supports thinking levels minimal/low/medium/high, system instructions and JSON output, so the AI Coach
 * request (LOW thinking, maxOutputTokens 4096) is valid on it unchanged. Independent capacity is likely, not guaranteed.
 */
export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
/** Do not start a retry or the fallback attempt with less than this much of the shared deadline left. */
export const GEMINI_FALLBACK_MIN_REMAINING_MS = 10_000;
/** Hard cap on HTTP requests per generation: primary, one primary retry, one fallback. */
export const GEMINI_MAX_ATTEMPTS = 3;
export const GEMINI_RETRY_BASE_DELAY_MS = 1_000;
export const GEMINI_RETRY_MAX_DELAY_MS = 2_000;

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
  /** Minimum deadline left for a retry or fallback attempt to start. Defaults to 10 s; lowered in tests only. */
  minRemainingMs?: number;
  /** Back-off bounds. Default 1-2 s; lowered in tests only. */
  retryDelay?: { baseMs: number; maxMs: number };
  /** Jitter source in [0, 1). Defaults to Math.random; injected in tests only. */
  random?: () => number;
}

const normalizeModel = (m: unknown): string => String(m ?? '').replace(/^models\//, '');

function isUnavailable(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 503 || status === 'UNAVAILABLE';
}

/** Only a numeric HTTP status or an upper-case status name is ever logged; never provider message text. */
function safeStatus(error: unknown): number | string | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return status;
  if (typeof status === 'string' && /^[A-Z_]{3,40}$/.test(status)) return status;
  if ((error as { name?: unknown } | null)?.name === 'AbortError') return 'ABORTED';
  return undefined;
}

export function backoffDelayMs(retryIndex: number, baseMs: number, maxMs: number, random: () => number): number {
  const jitter = Math.min(Math.max(random(), 0), 0.999999);
  return Math.min(maxMs, baseMs * 2 ** retryIndex * (1 + jitter));
}

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/** Abortable wait. Clears its timer and its listener on every path. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
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
  const baseMs = wrapperOptions.retryDelay?.baseMs ?? GEMINI_RETRY_BASE_DELAY_MS;
  const maxMs = wrapperOptions.retryDelay?.maxMs ?? GEMINI_RETRY_MAX_DELAY_MS;
  const random = wrapperOptions.random ?? Math.random;

  models.generateContent = (async (params: Parameters<typeof generate>[0]) => {
    const generationId = randomUUID();
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const callerSignal = params.config?.abortSignal;
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    const requested = normalizeModel(params.model);
    const attemptedModels: string[] = [];
    const failedStatuses: Array<number | string | undefined> = [];
    const remainingMs = () => timeoutMs - (Date.now() - startedAt);
    const elapsedMs = () => Date.now() - startedAt;

    /** One HTTP request. `model` overrides the requested model (fallback only). Counted and bounded by the caller. */
    const run = (model?: string) => {
      const first = attemptedModels.length === 0;
      attemptedModels.push(model ?? requested);
      const left = remainingMs();
      const callerTimeout = params.config?.httpOptions?.timeout;
      return generate({
        ...params,
        ...(model ? { model } : {}),
        config: {
          ...params.config,
          abortSignal: controller.signal,
          // Transport only: keep the SDK's X-Server-Timeout header in line with what is really left of the deadline.
          ...(first ? {} : { httpOptions: { ...params.config?.httpOptions, timeout: Math.min(left, callerTimeout ?? left) } })
        }
      });
    };

    const giveUp = (error: unknown, reason: string): never => {
      logger.warn('gemini_recovery_failed', {
        generationId,
        reason,
        attempts: attemptedModels.length,
        models: attemptedModels,
        statuses: failedStatuses,
        fallbackAttempted: fallbackModel !== null && fallbackModel !== requested && attemptedModels.includes(fallbackModel),
        elapsedMs: elapsedMs()
      });
      throw error;
    };

    try {
      // Attempt 1: primary.
      let error: unknown;
      try {
        return await run();
      } catch (e) {
        if (!isUnavailable(e)) throw e; // not a capacity error: no recovery, no extra log (the route logs it)
        error = e;
        failedStatuses.push(safeStatus(e));
      }

      // Attempt 2: one bounded, jittered retry of the primary.
      const delayMs = backoffDelayMs(0, baseMs, maxMs, random);
      if (controller.signal.aborted) return giveUp(error, 'aborted');
      if (remainingMs() - delayMs < minRemainingMs) return giveUp(error, 'insufficient_time');
      logger.warn('gemini_retry', { generationId, attempt: 1, model: requested, status: failedStatuses[0], delayMs: Math.round(delayMs) });
      try {
        await sleep(delayMs, controller.signal);
      } catch (e) {
        return giveUp(e, 'aborted');
      }
      try {
        const response = await run();
        logger.info('gemini_retry_succeeded', { generationId, model: requested, attempts: attemptedModels.length, elapsedMs: elapsedMs() });
        return response;
      } catch (e) {
        failedStatuses.push(safeStatus(e)); // every failed request is recorded, whatever its status
        if (!isUnavailable(e)) return giveUp(e, controller.signal.aborted ? 'aborted' : 'non_retryable');
        error = e;
      }

      // Attempt 3: one request to the fallback model; never retried.
      if (!fallbackModel || requested === fallbackModel) return giveUp(error, 'no_fallback');
      if (controller.signal.aborted) return giveUp(error, 'aborted');
      if (remainingMs() < minRemainingMs) return giveUp(error, 'insufficient_time');
      logger.warn('gemini_fallback', { generationId, attempt: 2, from: requested, to: fallbackModel, status: failedStatuses[1] });
      try {
        const response = await run(fallbackModel);
        logger.info('gemini_fallback_succeeded', { generationId, from: requested, to: fallbackModel, attempts: attemptedModels.length, elapsedMs: elapsedMs() });
        return response;
      } catch (e) {
        failedStatuses.push(safeStatus(e));
        return giveUp(e, isUnavailable(e) ? 'exhausted' : controller.signal.aborted ? 'aborted' : 'non_retryable');
      }
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }) as typeof models.generateContent;

  return ai;
}
