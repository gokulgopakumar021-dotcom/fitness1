import { list, loose, object, oneOf, text } from '../security/validation';
import { WEARABLE_CONSENT_CATEGORIES } from '../../wearables/consentPolicy';

/** The client sends category NAMES only. User ids, ownership, quality and "verified" claims are not in any schema, so they are dropped. */
export const wearableSchemas = {
  consentUpdate: object({ categories: list(oneOf(WEARABLE_CONSENT_CATEGORIES), { max: WEARABLE_CONSENT_CATEGORIES.length, required: true }) }),
  /** BT-04C: one workout session id per request, in the body (the project does not read query strings; see normalizeUrl tripwire). */
  workoutHeartRate: object({ sessionId: text({ max: 128, required: true }) }),
  /** BT-04C task 4: no input. The account comes from the verified token; there is nothing for the client to choose. */
  consentHistory: object({}),
  ingest: object({
    device: loose({ kind: 'object', required: true, maxKeys: 10, maxDepth: 2, maxString: 200 }),
    workoutSessionId: text({ max: 128 }),
    // Bounded here; the handler enforces the 200-record batch limit and reports each record's outcome.
    samples: loose({ kind: 'array', required: true, maxArray: 500, maxKeys: 16, maxDepth: 2, maxString: 200 })
  })
};
