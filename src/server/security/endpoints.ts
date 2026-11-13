import { schemas, type Schema } from './validation';
import { billingSchemas } from '../billing/schemas';

/**
 * Single source of truth for per-endpoint policy: rate limit, daily AI quota, body-size limit and request schema.
 * Every limit is a DEFAULT PROPOSAL, overridable at deploy time via AI_QUOTA_OVERRIDES (see config.ts).
 * A path that is not listed here is rejected with 404 after authentication, so new routes must be registered here.
 */
export interface EndpointPolicy {
  bucket: string;
  /** Calls Gemini: counts against the daily quota. */
  ai: boolean;
  dailyQuota?: number;
  perMinute: number;
  /** express.json `limit` value. */
  bodyLimit: string;
  schema?: Schema;
  /**
   * Stays reachable for a signed-in user whose 18+ declaration is missing (see ageGate.ts). Only for routes that let a user
   * leave or stop paying: account deletion and subscription cancellation. Everything else is gated.
   */
  ageExempt?: boolean;
}

const SMALL = '64kb';
const MEDIUM = '256kb';
const LARGE = '1mb';
const XLARGE = '4mb'; // full session history (recovery insights); proposal, verify against real data volumes

export const ENDPOINTS: Record<string, EndpointPolicy> = {
  'POST /extract-plan': { bucket: 'extract-plan', ai: true, dailyQuota: 10, perMinute: 3, bodyLimit: '14mb', schema: schemas.extractPlan },
  'POST /generate-plan': { bucket: 'generate-plan', ai: true, dailyQuota: 20, perMinute: 5, bodyLimit: SMALL, schema: schemas.generatePlan },
  'POST /exercise-coach': { bucket: 'exercise-coach', ai: true, dailyQuota: 60, perMinute: 10, bodyLimit: SMALL, schema: schemas.exerciseCoach },
  'POST /generate-ai-routine': { bucket: 'generate-ai-routine', ai: true, dailyQuota: 20, perMinute: 5, bodyLimit: MEDIUM, schema: schemas.generateAiRoutine },
  'POST /ai-food-parser': { bucket: 'ai-food-parser', ai: true, dailyQuota: 100, perMinute: 15, bodyLimit: SMALL, schema: schemas.foodParser },
  'POST /ai-workout-insights': { bucket: 'ai-workout-insights', ai: true, dailyQuota: 40, perMinute: 8, bodyLimit: LARGE, schema: schemas.workoutInsights },
  'POST /ai-plan-overload-tuning': { bucket: 'ai-plan-overload-tuning', ai: true, dailyQuota: 30, perMinute: 5, bodyLimit: LARGE, schema: schemas.planOverloadTuning },
  'POST /ai-nutrition-coach': { bucket: 'ai-nutrition-coach', ai: true, dailyQuota: 40, perMinute: 8, bodyLimit: MEDIUM, schema: schemas.nutritionCoach },
  'POST /ai-recovery-insights': { bucket: 'ai-recovery-insights', ai: true, dailyQuota: 40, perMinute: 8, bodyLimit: XLARGE, schema: schemas.recoveryInsights },
  'POST /ai-personal-trainer': { bucket: 'ai-personal-trainer', ai: true, dailyQuota: 100, perMinute: 12, bodyLimit: LARGE, schema: schemas.personalTrainer },
  'POST /adaptive-coach/explain': { bucket: 'adaptive-coach-explain', ai: true, dailyQuota: 60, perMinute: 10, bodyLimit: MEDIUM, schema: schemas.adaptiveCoachExplain },
  'POST /ai-form-analyzer': { bucket: 'ai-form-analyzer', ai: true, dailyQuota: 40, perMinute: 8, bodyLimit: SMALL, schema: schemas.formAnalyzer },
  'POST /ai-warmup-generator': { bucket: 'ai-warmup-generator', ai: true, dailyQuota: 30, perMinute: 6, bodyLimit: SMALL, schema: schemas.warmupGenerator },
  'POST /ai-generate-physique': { bucket: 'ai-generate-physique', ai: true, dailyQuota: 10, perMinute: 3, bodyLimit: SMALL, schema: schemas.generatePhysique },
  'POST /ai-physique-analysis': { bucket: 'ai-physique-analysis', ai: true, dailyQuota: 10, perMinute: 3, bodyLimit: MEDIUM, schema: schemas.physiqueAnalysis }
};

/** Billing (Stage 2). Not AI routes: no AI quota. Tight per-minute limits because each write calls Razorpay. */
export const BILLING_ENDPOINTS: Record<string, EndpointPolicy> = {
  'GET /billing/status': { bucket: 'billing-status', ai: false, perMinute: 30, bodyLimit: SMALL },
  'GET /billing/payments': { bucket: 'billing-payments', ai: false, perMinute: 20, bodyLimit: SMALL },
  'POST /billing/subscriptions': { bucket: 'billing-create', ai: false, perMinute: 5, bodyLimit: SMALL, schema: billingSchemas.createSubscription },
  'POST /billing/subscriptions/verify': { bucket: 'billing-verify', ai: false, perMinute: 10, bodyLimit: SMALL, schema: billingSchemas.verifySubscription },
  'POST /billing/subscriptions/cancel': { bucket: 'billing-cancel', ai: false, perMinute: 5, bodyLimit: SMALL, schema: billingSchemas.empty, ageExempt: true },
  // Stage 5: payment recovery (pending/halted) and the cancel-then-delete flow. Each calls Razorpay, so the limits are tight.
  'POST /billing/subscriptions/recover': { bucket: 'billing-recover', ai: false, perMinute: 5, bodyLimit: SMALL, schema: billingSchemas.empty },
  'GET /billing/account/deletion-check': { bucket: 'billing-deletion-check', ai: false, perMinute: 10, bodyLimit: SMALL, ageExempt: true },
  'POST /billing/account/prepare-deletion': { bucket: 'billing-prepare-deletion', ai: false, perMinute: 5, bodyLimit: SMALL, schema: billingSchemas.prepareDeletion, ageExempt: true }
};

export const BARCODE_POLICY: EndpointPolicy = { bucket: 'barcode', ai: false, perMinute: 30, bodyLimit: SMALL };

export function resolvePolicy(method: string, path: string): EndpointPolicy | undefined {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const hit = ENDPOINTS[`${method.toUpperCase()} ${clean}`] ?? BILLING_ENDPOINTS[`${method.toUpperCase()} ${clean}`];
  if (hit) return hit;
  if (method.toUpperCase() === 'GET' && /^\/nutrition\/barcode\/[^/]+$/.test(clean)) return BARCODE_POLICY;
  return undefined;
}

/**
 * Buckets that never accept a degraded (per-instance) rate count: if the shared store is down they get 503
 * `rate_limit_unavailable`, whatever RATE_LIMIT_FAILURE_POLICY says. `extract-plan` is the only route that forwards
 * user-supplied files (up to 14 MB, PDF/image) to Gemini. The two physique routes are text-only and take body-composition
 * inputs; `ai-physique-analysis` returns the largest structured output of any route (nutrition and training blueprint),
 * `ai-generate-physique` a short capped description. Keeping both closed is an owner decision (one Dream Physique flow),
 * not a cost rule: see docs/security/route-failure-policy.md. Their daily quota is fail-closed too:
 * DegradingQuotaStore never counts them in memory (see quota.ts).
 */
export const ALWAYS_CLOSED_BUCKETS: ReadonlySet<string> = new Set(['extract-plan', 'ai-generate-physique', 'ai-physique-analysis']);

export function isAlwaysClosed(method: string, path: string): boolean {
  const p = resolvePolicy(method, path);
  return !!p && ALWAYS_CLOSED_BUCKETS.has(p.bucket);
}
