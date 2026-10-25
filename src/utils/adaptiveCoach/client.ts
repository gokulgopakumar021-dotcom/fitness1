import { AdaptiveReview, AiExplanation, CoachingContext } from './types';

export type ExplainOutcome =
  | { kind: 'ai'; explanation: AiExplanation }
  | { kind: 'unavailable'; reason: 'not_configured' | 'invalid_ai_response' | 'nothing_to_explain' | 'timeout' | 'network' | 'service_error' };

const CLIENT_TIMEOUT_MS = 25000;

/** Asks the existing server integration for wording only. Never throws; failures are explicit outcomes. */
export async function requestAiExplanation(
  context: CoachingContext,
  review: AdaptiveReview,
  fetchImpl: typeof fetch = fetch
): Promise<ExplainOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetchImpl('/api/adaptive-coach/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context }),
      signal: controller.signal
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      return { kind: 'unavailable', reason: 'service_error' };
    }
    if (!res.ok || !data?.success) return { kind: 'unavailable', reason: 'service_error' };
    if (!data.aiAvailable) {
      const r = data.reason;
      return { kind: 'unavailable', reason: r === 'not_configured' || r === 'invalid_ai_response' || r === 'nothing_to_explain' ? r : 'service_error' };
    }
    // Only accept wording that was written for exactly this review.
    if (data.fingerprint !== review.fingerprint || !data.explanation) return { kind: 'unavailable', reason: 'service_error' };
    return { kind: 'ai', explanation: data.explanation as AiExplanation };
  } catch (e) {
    return { kind: 'unavailable', reason: (e as Error)?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}
