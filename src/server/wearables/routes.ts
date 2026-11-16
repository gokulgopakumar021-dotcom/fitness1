import type { Express, Request, Response } from 'express';
import { getAccessToken } from '../security/auth';
import { sendError } from '../security/errors';
import { logger } from '../security/logger';
import { WEARABLE_CONSENT_VERSION, activeCategories } from '../../wearables/consentPolicy';
import { finalizeResults, isValidSessionId, prepareBatch, summarize } from './ingest';
import { summarizeWorkoutHeartRate } from '../../wearables/workoutHrSummary';
import { SupabaseWearableStore, WearableConsentRequiredError, WearableStoreUnavailableError, type WearableStore } from './store';
import type { SecurityConfig } from '../security/config';

export interface WearableDeps { store?: WearableStore; now?: () => Date }

const unavailable = (req: Request, res: Response) => sendError(req, res, 503, 'wearable_store_unavailable', 'Wearable data is temporarily unavailable. Nothing was changed.', { 'Retry-After': '5' });

export function registerWearableRoutes(app: Express, config: Pick<SecurityConfig, 'supabaseUrl' | 'supabaseKey'>, deps: WearableDeps = {}) {
  const store = deps.store ?? new SupabaseWearableStore(config);
  const now = deps.now ?? (() => new Date());

  app.get('/api/wearables/consent', async (req, res) => {
    try {
      const rec = await store.readConsent(req.user!.id, getAccessToken(req));
      const active = [...activeCategories(rec)];
      return res.json({
        success: true, currentVersion: WEARABLE_CONSENT_VERSION, categories: active,
        // A record under another version authorises nothing; the UI must ask again.
        stale: !!rec && rec.version !== WEARABLE_CONSENT_VERSION
      });
    } catch (err) {
      if (err instanceof WearableStoreUnavailableError) { logger.warn('wearable_consent_unavailable', { requestId: req.requestId, reason: err.reason }); return unavailable(req, res); }
      throw err;
    }
  });

  // Replaces the account's consent set. An empty list revokes everything. Takes effect on the next request (no server cache).
  app.put('/api/wearables/consent', async (req, res) => {
    const categories = [...new Set((req.body.categories as string[]) ?? [])];
    try {
      await store.setConsent(getAccessToken(req), categories, WEARABLE_CONSENT_VERSION);
      logger.info('wearable_consent_changed', { requestId: req.requestId, count: categories.length });
      return res.json({ success: true, currentVersion: WEARABLE_CONSENT_VERSION, categories, stale: false });
    } catch (err) {
      if (err instanceof WearableStoreUnavailableError) { logger.warn('wearable_consent_write_unavailable', { requestId: req.requestId, reason: err.reason }); return unavailable(req, res); }
      throw err;
    }
  });

  // BT-04C task 4: the account's own consent audit trail (granted/revoked, category, version, time), newest first. Read-only:
  // there is no edit or delete route. POST with an empty body because the project never reads the query string.
  app.post('/api/wearables/consent-history', async (req, res) => {
    try {
      const read = await store.readConsentHistory(req.user!.id, getAccessToken(req));
      return res.json({ success: true, events: read.events, truncated: read.truncated });
    } catch (err) {
      if (err instanceof WearableStoreUnavailableError) { logger.warn('wearable_consent_history_unavailable', { requestId: req.requestId, reason: err.reason }); return unavailable(req, res); }
      throw err;
    }
  });

  // BT-04C: the account's OWN stored heart rate for one workout, for the workout history. POST only because every route here takes a
  // schema-validated JSON body (the project never reads the query string); it is read-only and derived; nothing is written
  // and existing workout statistics are untouched. No consent category gates reading your own stored data (consent governs storing
  // and AI sharing); revoking consent stops new storage and AI use but does not hide or delete what is already stored.
  app.post('/api/wearables/workout-heart-rate', async (req, res) => {
    const sessionId = req.body.sessionId;
    if (!isValidSessionId(sessionId)) return sendError(req, res, 400, 'invalid_workout_session', 'sessionId is not a valid id.');
    try {
      const read = await store.readWorkoutHeartRate(req.user!.id, getAccessToken(req), sessionId);
      return res.json({ success: true, sessionId, summary: summarizeWorkoutHeartRate(read.samples, read.truncated) });
    } catch (err) {
      if (err instanceof WearableStoreUnavailableError) { logger.warn('wearable_workout_hr_unavailable', { requestId: req.requestId, reason: err.reason }); return unavailable(req, res); }
      throw err;
    }
  });

  app.post('/api/wearables/ingest', async (req, res) => {
    const token = getAccessToken(req);
    const prepared = prepareBatch(req.body, now);
    if (!prepared.ok) return sendError(req, res, prepared.code === 'batch_too_large' ? 413 : 400, prepared.code, prepared.message);

    try {
      // Consent is read from the database for every request. Storing health data needs workout_health_sync and nothing else implies it.
      const allowed = activeCategories(await store.readConsent(req.user!.id, token));
      if (!allowed.has('workout_health_sync')) {
        return sendError(req, res, 403, 'consent_required', 'Turn on workout health-data sync in Wearables settings before sending measurements.');
      }
      let outcome: { insertedKeys: string[]; verifiedKeys: string[]; outsideSessionKeys: string[] } = { insertedKeys: [], verifiedKeys: [], outsideSessionKeys: [] };
      if (prepared.rows.length) {
        outcome = await store.ingest(token, prepared.device, prepared.rows);
      }
      const results = finalizeResults(prepared, outcome.insertedKeys, { verifiedKeys: outcome.verifiedKeys, outsideSessionKeys: outcome.outsideSessionKeys });
      const summary = summarize(results);
      // Counts only: measurements, device identifiers and session ids are never logged.
      logger.info('wearable_ingest', { requestId: req.requestId, ...summary });
      return res.json({ success: true, summary, results, syncedAt: now().toISOString() });
    } catch (err) {
      if (err instanceof WearableConsentRequiredError) return sendError(req, res, 403, 'consent_required', 'Turn on workout health-data sync in Wearables settings before sending measurements.');
      if (err instanceof WearableStoreUnavailableError) { logger.warn('wearable_ingest_unavailable', { requestId: req.requestId, reason: err.reason }); return unavailable(req, res); }
      throw err;
    }
  });
}
