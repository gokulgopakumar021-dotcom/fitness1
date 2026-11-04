import { GoogleGenAI, type GoogleGenAIOptions } from '@google/genai';

/**
 * Gemini client factory with a hard upper bound on every model call (Stage 3.8, owner decision: 90 s).
 *
 * Why a wrapper and not only `httpOptions.timeout`: the SDK applies that timeout per HTTP attempt and retries
 * 408/429/5xx up to 5 attempts with exponential back-off, so a per-attempt timeout alone could run for minutes. Here every
 * `generateContent` call gets one AbortController that fires after `timeoutMs` for the WHOLE call (all retries and
 * back-off included). The abort rejects with an `AbortError`, which `classifyError` already maps to the fixed
 * `504 upstream_timeout` response (no provider text is ever forwarded). The timer is cleared when the call settles, so it
 * never keeps an invocation alive. A caller-supplied `abortSignal` is still honoured.
 *
 * It must stay below the Vercel function `maxDuration` (120 s, vercel.json) so the route can still answer.
 */
export const GEMINI_TIMEOUT_MS = 90_000;

export function createGenAI(options: GoogleGenAIOptions, timeoutMs: number = GEMINI_TIMEOUT_MS): GoogleGenAI {
  const ai = new GoogleGenAI({ ...options, httpOptions: { ...options.httpOptions, timeout: timeoutMs } });
  const models = ai.models;
  const generate = models.generateContent.bind(models);

  models.generateContent = (async (params: Parameters<typeof generate>[0]) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const callerSignal = params.config?.abortSignal;
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
    try {
      return await generate({ ...params, config: { ...params.config, abortSignal: controller.signal } });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }) as typeof models.generateContent;

  return ai;
}
