// @vitest-environment node
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generate = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generate };
  }
}));

import { createApp } from '../../../server';
import { aiFixtures } from './aiFixtures';
import { aiOutputSchemas, capFreeText, checkAiOutput, type AiOutputRoute } from './aiSchemas';
import { ApiError } from './errors';
import { fakeToken, listen, mockVerifier, testConfig } from './testUtils';

/* ---------- helpers ---------- */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const segs = (path: string) => path.split(/[.[\]]+/).filter(Boolean);
function mutate(obj: any, path: string, op: 'set' | 'del', value?: unknown) {
  const s = segs(path);
  let cur = obj;
  for (const k of s.slice(0, -1)) cur = cur[k];
  const last = s[s.length - 1];
  if (op === 'del') delete cur[last];
  else cur[last] = value;
  return obj;
}
const fixture = (route: AiOutputRoute) => clone(aiFixtures[route]) as any;
const ok = (route: AiOutputRoute, raw: unknown) => aiOutputSchemas[route](raw, 'output').ok;

/** Per-route mutations. Every `bad` entry must be rejected; `excessive` values are out of range / over cap. */
const CASES: Record<AiOutputRoute, { missing: string; wrongType: [string, unknown]; excessive?: [string, unknown] }> = {
  generatePlan: { missing: 'days', wrongType: ['days', 'not-an-array'], excessive: ['days[0].exercises[0].workingSets', 9999] },
  exerciseCoach: { missing: 'cues', wrongType: ['cues', 'Brace'], excessive: ['cues', Array(9).fill('x')] },
  generateAiRoutine: { missing: 'routineName', wrongType: ['exercises', {}], excessive: ['durationMinutes', 99_999] },
  foodParser: { missing: 'items', wrongType: ['items', { name: 'x' }], excessive: ['items[0].calories', 1e9] },
  workoutInsights: { missing: 'headline', wrongType: ['headline', { a: 1 }] },
  planOverloadTuning: { missing: 'exerciseCalibrations', wrongType: ['recommendedPhase', 'bogus'], excessive: ['exerciseCalibrations[0].recommendedWorkingSets', 500] },
  nutritionCoach: { missing: 'dailyCalories', wrongType: ['dailyCalories', 'lots'], excessive: ['proteinGrams', 1e6] },
  recoveryInsights: { missing: 'systemicFatigueLevel', wrongType: ['muscleRecovery', 'x'], excessive: ['muscleRecovery[0].recoveryPercentage', 900] },
  warmupGenerator: { missing: 'phases', wrongType: ['phases', []], excessive: ['phases[0].durationSeconds', 99_999] },
  physiqueBlueprint: { missing: 'nutritionPlan', wrongType: ['workoutPlan.days', 'x'], excessive: ['nutritionPlan.calorieTarget', 1e7] }
};
const ROUTES = Object.keys(aiOutputSchemas) as AiOutputRoute[];

/* ---------- unit: every schema ---------- */
describe.each(ROUTES)('AI output schema: %s', (route) => {
  it('accepts a valid output unchanged (existing response contract preserved)', () => {
    const r = aiOutputSchemas[route](fixture(route), 'output');
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toEqual(fixture(route));
  });

  it('rejects missing required fields, including an empty object', () => {
    expect(ok(route, mutate(fixture(route), CASES[route].missing, 'del'))).toBe(false);
    expect(ok(route, {})).toBe(false);
  });

  it('rejects incorrect types', () => {
    const [path, value] = CASES[route].wrongType;
    expect(ok(route, mutate(fixture(route), path, 'set', value))).toBe(false);
  });

  it('rejects excessive values and over-long arrays', () => {
    const ex = CASES[route].excessive;
    if (!ex) return;
    expect(ok(route, mutate(fixture(route), ex[0], 'set', ex[1]))).toBe(false);
  });

  it.each([null, undefined, 'a string', 42, true, [], [fixture(route)]])('rejects a non-object top level: %j', (raw) => {
    expect(ok(route, raw)).toBe(false);
  });

  it('drops unexpected fields at top level (never copies them)', () => {
    const raw = { ...fixture(route), evil: '<script>x</script>', admin: true };
    const r = aiOutputSchemas[route](raw, 'output');
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).not.toHaveProperty('evil');
    expect(r.ok && r.value).not.toHaveProperty('admin');
  });

  it('survives prototype-pollution payloads: no own __proto__/constructor, global prototype untouched', () => {
    const base = JSON.stringify(fixture(route)).slice(1);
    const raw = JSON.parse(`{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"prototype":{"polluted":"yes"},${base}`);
    const r = aiOutputSchemas[route](raw, 'output');
    expect(r.ok).toBe(true);
    const value = (r.ok ? r.value : {}) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(value, 'constructor')).toBe(false);
    expect((value as any).polluted).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  it('does not echo rejected values in its issue text', () => {
    const [path] = CASES[route].wrongType;
    const r = aiOutputSchemas[route](mutate(fixture(route), path, 'set', 'SECRET-MODEL-TEXT-12345'), 'output');
    if (!r.ok) expect(r.issues.join(' ')).not.toContain('SECRET-MODEL-TEXT-12345');
  });
});

/* ---------- unit: targeted behaviours ---------- */
describe('AI output schemas: nested structures and bounds', () => {
  it('rejects invalid nested items (null / string / array in an object list)', () => {
    for (const bad of [null, 'x', [], 7]) {
      expect(ok('generatePlan', mutate(fixture('generatePlan'), 'days[0].exercises', 'set', [bad]))).toBe(false);
      expect(ok('foodParser', mutate(fixture('foodParser'), 'items', 'set', [bad]))).toBe(false);
    }
  });

  it('rejects an exercise without a name and a day without exercises', () => {
    expect(ok('generatePlan', mutate(fixture('generatePlan'), 'days[0].exercises[0].name', 'del'))).toBe(false);
    expect(ok('generatePlan', mutate(fixture('generatePlan'), 'days[0].exercises', 'del'))).toBe(false);
  });

  it('truncates over-long strings rather than rejecting them, and strips control characters', () => {
    const f = fixture('workoutInsights');
    f.headline = 'H'.repeat(50_000);
    f.volumeTakeaway = 'ok\u0000\u0007text';
    const r = aiOutputSchemas.workoutInsights(f, 'output');
    expect(r.ok).toBe(true);
    const v = (r.ok ? r.value : {}) as any;
    expect(v.headline).toHaveLength(300);
    expect(v.volumeTakeaway).toBe('oktext');
  });

  it('coerces numeric strings (models sometimes quote numbers) but not prose', () => {
    expect(ok('nutritionCoach', mutate(fixture('nutritionCoach'), 'dailyCalories', 'set', '2800'))).toBe(true);
    expect(ok('nutritionCoach', mutate(fixture('nutritionCoach'), 'dailyCalories', 'set', '2800 kcal'))).toBe(false);
    expect(ok('nutritionCoach', mutate(fixture('nutritionCoach'), 'dailyCalories', 'set', null))).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, -1])('rejects non-finite / negative numbers: %s', (n) => {
    expect(ok('nutritionCoach', mutate(fixture('nutritionCoach'), 'dailyCalories', 'set', n))).toBe(false);
  });

  it('keeps absent optional fields absent (no [] / "" defaults that would defeat client `x || fallback`)', () => {
    const f = fixture('recoveryInsights');
    delete f.recoveryTips;
    delete f.optimalRestDays;
    const r = aiOutputSchemas.recoveryInsights(f, 'output');
    expect(r.ok).toBe(true);
    const v = (r.ok ? r.value : {}) as any;
    expect('recoveryTips' in v).toBe(false);
    expect('optimalRestDays' in v).toBe(false);
  });

  it('rejects an enum value outside the contract', () => {
    expect(ok('recoveryInsights', mutate(fixture('recoveryInsights'), 'muscleRecovery[0].status', 'set', 'Fresh!'))).toBe(false);
    expect(ok('warmupGenerator', mutate(fixture('warmupGenerator'), 'phases[0].phase', 'set', 'Sprint'))).toBe(false);
  });

  it('rejects a deeply nested hostile structure where a string is expected', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 5_000; i++) deep = [deep];
    expect(ok('exerciseCoach', mutate(fixture('exerciseCoach'), 'cues', 'set', [deep]))).toBe(false);
  });
});

describe('checkAiOutput / capFreeText', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('throws a 502 ai_invalid_response ApiError with a static message and logs field paths only', () => {
    let err: unknown;
    try {
      checkAiOutput('nutritionCoach', { dailyCalories: 'SECRET-MODEL-TEXT-999', proteinGrams: 1 }, { requestId: 'req-1', user: { id: 'u1' } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).code).toBe('ai_invalid_response');
    expect((err as ApiError).message).not.toContain('SECRET');
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('ai_output_invalid');
    expect(logged).toContain('dailyCalories');
    expect(logged).not.toContain('SECRET-MODEL-TEXT-999');
  });

  it('returns the sanitised value on success', () => {
    expect(checkAiOutput('exerciseCoach', aiFixtures.exerciseCoach).cues).toHaveLength(3);
  });

  it('capFreeText caps, strips control chars, and falls back for non-strings / empty text', () => {
    expect(capFreeText('a'.repeat(9_999), 100)).toHaveLength(100);
    expect(capFreeText('hi\u0000\u001f there', 100)).toBe('hi there');
    expect(capFreeText(undefined, 100, 'fallback')).toBe('fallback');
    expect(capFreeText({ x: 1 }, 100, 'fallback')).toBe('fallback');
    expect(capFreeText('   ', 100, 'fallback')).toBe('fallback');
  });
});

/* ---------- integration: through the real Express handlers ---------- */
type Srv = Awaited<ReturnType<typeof listen>>;
let srv: Srv | null = null;
let logSpies: ReturnType<typeof vi.spyOn>[] = [];

const ROUTE_HTTP: Record<AiOutputRoute, { path: string; body: unknown; key: string }> = {
  generatePlan: { path: '/generate-plan', body: { goal: 'Hypertrophy', split: 'PPL', daysPerWeek: 4 }, key: 'plan' },
  exerciseCoach: { path: '/exercise-coach', body: { exerciseName: 'Bench Press', equipment: 'barbell', targetReps: '8-12', targetRir: 2 }, key: 'data' },
  generateAiRoutine: {
    path: '/generate-ai-routine',
    body: { muscleRecoveryData: [{ label: 'Chest', recoveryStatus: 'recovered', setsPast7Days: 6, daysSinceLastTrained: null }], availableEquipment: ['barbell'], recentEquipmentUsed: [], equipmentNotes: '', trainingSplitFocus: 'Push', sessionDurationMinutes: 60, targetExerciseCount: 6, experienceLevel: 'Intermediate', primaryGoal: 'Muscle Gain', injuriesOrDeload: '' },
    key: 'routine'
  },
  foodParser: { path: '/ai-food-parser', body: { query: '2 eggs', mealCategory: 'breakfast' }, key: 'items' },
  workoutInsights: { path: '/ai-workout-insights', body: { session: { dayName: 'Push', date: '2026-10-01', exercises: [] }, profile: { name: 'A' } }, key: 'insights' },
  planOverloadTuning: { path: '/ai-plan-overload-tuning', body: { plan: { name: 'PPL', trainingSplit: 'PPL', days: [] }, profile: { preferredUnit: 'kg' }, historySummary: 'x' }, key: 'calibrations' },
  nutritionCoach: { path: '/ai-nutrition-coach', body: { profile: { age: 30, heightCm: 180 }, recentWeightTrend: [80, 79.5] }, key: 'plan' },
  recoveryInsights: { path: '/ai-recovery-insights', body: { sessions: [], profile: { name: 'A' }, activePlan: { name: 'PPL' } }, key: 'recovery' },
  warmupGenerator: { path: '/ai-warmup-generator', body: { muscleGroups: ['Chest'], exercises: ['Bench Press'], workoutName: 'Push', intensity: 'moderate' }, key: 'routine' },
  physiqueBlueprint: { path: '/ai-physique-analysis', body: { dreamPhysique: { archetype: 'v_taper', title: 'x' }, currentProfile: { name: 'A' } }, key: 'blueprint' }
};

async function call(path: string, body: unknown) {
  const res = await fetch(`${srv!.base}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fakeToken()}` },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, raw };
}

describe('AI output validation through the Express handlers', () => {
  beforeEach(async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    generate.mockReset();
    logSpies = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'log').mockImplementation(() => {})];
    const app: Express = createApp({ verifyToken: mockVerifier, config: testConfig({ rateUserPerMin: 10_000, rateIpPerMin: 10_000 }) });
    srv = await listen(app);
  });
  afterEach(async () => {
    logSpies.forEach((s) => s.mockRestore());
    await srv?.close();
    srv = null;
  });

  describe.each(ROUTES)('%s', (route) => {
    const { path, body, key } = ROUTE_HTTP[route];

    it('returns 200 with the unchanged contract for valid model output', async () => {
      generate.mockResolvedValue({ text: JSON.stringify(aiFixtures[route]) });
      const r = await call(path, body);
      expect(r.status).toBe(200);
      expect(r.json.success).toBe(true);
      const payload = key === 'items' ? { items: r.json.items } : r.json[key];
      const expected = key === 'items' ? aiFixtures.foodParser : aiFixtures[route];
      if (route === 'generateAiRoutine') expect(payload).toMatchObject({ routineName: 'Adaptive Push', isAiGenerated: true, equipmentUsed: ['barbell'] });
      else expect(payload).toEqual(expected);
    });

    it('accepts JSON wrapped in a markdown fence (existing fallback preserved)', async () => {
      generate.mockResolvedValue({ text: '```json\n' + JSON.stringify(aiFixtures[route]) + '\n```' });
      expect((await call(path, body)).status).toBe(200);
    });

    it.each([
      ['an empty object', '{}'],
      ['a JSON array', '[1,2,3]'],
      ['JSON null', 'null'],
      ['a bare string', '"hello"'],
      ['malformed JSON', '{"cues": [ "unterminated']
    ])('returns a safe 502 ai_invalid_response for %s', async (_label, text) => {
      generate.mockResolvedValue({ text: `${text}` });
      const r = await call(path, body);
      expect(r.status).toBe(502);
      expect(r.json).toMatchObject({ success: false, code: 'ai_invalid_response' });
      expect(r.json).not.toHaveProperty(key);
    });

    it('never forwards the model text or internal details on rejection', async () => {
      generate.mockResolvedValue({ text: JSON.stringify({ error: 'SECRET internal reasoning https://internal.example', stack: 'at /srv/app.ts' }) });
      const r = await call(path, body);
      expect(r.status).toBe(502);
      expect(r.raw).not.toContain('SECRET');
      expect(r.raw).not.toContain('internal.example');
      expect(r.raw).not.toContain('/srv/app.ts');
    });

    it('drops unexpected fields and ignores prototype-pollution keys from the model', async () => {
      const base = JSON.stringify(aiFixtures[route]).slice(1);
      generate.mockResolvedValue({ text: `{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"injected":"<img onerror=x>",${base}` });
      const r = await call(path, body);
      expect(r.status).toBe(200);
      expect(r.raw).not.toContain('injected');
      expect(r.raw).not.toContain('polluted');
      expect(({} as any).polluted).toBeUndefined();
    });
  });

  it('rejects out-of-contract values from the model on a live route (excessive number)', async () => {
    generate.mockResolvedValue({ text: JSON.stringify({ ...aiFixtures.nutritionCoach, dailyCalories: 9_999_999 }) });
    const r = await call('/ai-nutrition-coach', ROUTE_HTTP.nutritionCoach.body);
    expect(r.status).toBe(502);
    expect(r.json.code).toBe('ai_invalid_response');
  });

  it('truncates (does not reject) an over-long string from the model on a live route', async () => {
    generate.mockResolvedValue({ text: JSON.stringify({ ...aiFixtures.workoutInsights, headline: 'H'.repeat(100_000) }) });
    const r = await call('/ai-workout-insights', ROUTE_HTTP.workoutInsights.body);
    expect(r.status).toBe(200);
    expect(r.json.insights.headline).toHaveLength(300);
  });

  describe('free-text routes are capped and sanitised', () => {
    it('personal trainer reply', async () => {
      generate.mockResolvedValue({ text: 'x'.repeat(60_000) + '\u0000' });
      const r = await call('/ai-personal-trainer', { messages: [{ role: 'user', text: 'hi' }], userMessage: 'how deep?', profile: { name: 'A' }, activeSession: null, bluetooth: { isConnected: false }, mirrorInsights: [] });
      expect(r.status).toBe(200);
      expect(r.json.reply).toHaveLength(4000);
    });
    it('personal trainer falls back when the model returns nothing', async () => {
      generate.mockResolvedValue({ text: '' });
      const r = await call('/ai-personal-trainer', { messages: [], userMessage: 'hi', profile: {}, activeSession: null, bluetooth: { isConnected: false }, mirrorInsights: [] });
      expect(r.status).toBe(200);
      expect(r.json.reply).toBe('Keep driving forward with pristine form!');
    });
    it('form analyzer cues', async () => {
      generate.mockResolvedValue({ text: 'c'.repeat(60_000) });
      const r = await call('/ai-form-analyzer', { exerciseName: 'Squat', userQuestion: 'knees?', experience: 'Beginner', goal: 'Strength' });
      expect(r.status).toBe(200);
      expect(r.json.cues).toHaveLength(3000);
    });
    it('physique description', async () => {
      generate.mockResolvedValue({ text: 'd'.repeat(60_000) });
      const r = await call('/ai-generate-physique', { archetype: 'v_taper', gender: 'male', targetBodyFat: 10, customPrompt: '', muscleEmphasis: ['Lats'] });
      expect(r.status).toBe(200);
      expect(r.json.physique.description).toHaveLength(1000);
    });
  });
});
