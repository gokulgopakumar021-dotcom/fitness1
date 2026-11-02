import type { NextFunction, Request, Response } from 'express';
import { ApiError } from './errors';

/**
 * Small dependency-free request validation. Every validator returns a sanitised value (control characters
 * stripped, unknown top-level keys dropped, numeric strings coerced where the existing clients send them) or a list
 * of issues. Issue text names fields only; it never echoes the rejected value back.
 */
export type Result<T = unknown> = { ok: true; value: T | undefined } | { ok: false; issues: string[] };
export type Validator<T = unknown> = (value: unknown, path: string) => Result<T>;
export type Schema = Validator<Record<string, unknown>>;

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const FENCE_TAG = /<\/?\s*user_input[^>]*>/gi;

const ok = <T>(value: T | undefined): Result<T> => ({ ok: true, value });
const bad = (path: string, msg: string): Result<never> => ({ ok: false, issues: [`${path}: ${msg}`] });
const absent = (v: unknown) => v === undefined || v === null;

/** Free text that ends up in a prompt: stripped of control chars and of anything that could close the prompt fence. */
export function cleanText(s: string): string {
  return s.replace(CONTROL, '').replace(FENCE_TAG, '').trim();
}

export function text(opts: { max: number; min?: number; required?: boolean; allowNumber?: boolean; truncate?: boolean }): Validator<string> {
  return (v, path) => {
    if (absent(v)) return opts.required ? bad(path, 'is required') : ok<string>(undefined);
    let s: string;
    if (typeof v === 'string') s = v;
    else if (opts.allowNumber && typeof v === 'number' && Number.isFinite(v)) s = String(v);
    else return bad(path, 'must be a string');
    s = cleanText(s);
    if (opts.truncate && s.length > opts.max) s = s.slice(0, opts.max);
    if (s.length > opts.max) return bad(path, `must be at most ${opts.max} characters`);
    if (s.length < (opts.min ?? (opts.required ? 1 : 0))) return bad(path, opts.required ? 'must not be empty' : `must be at least ${opts.min} characters`);
    return ok(s);
  };
}

export function num(opts: { min: number; max: number; int?: boolean; required?: boolean }): Validator<number> {
  return (v, path) => {
    if (absent(v) || v === '') return opts.required ? bad(path, 'is required') : ok<number>(undefined);
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return bad(path, 'must be a number');
    if (opts.int && !Number.isInteger(n)) return bad(path, 'must be an integer');
    if (n < opts.min || n > opts.max) return bad(path, `must be between ${opts.min} and ${opts.max}`);
    return ok(n);
  };
}

export function oneOf<T extends string>(allowed: readonly T[], opts: { required?: boolean } = {}): Validator<T> {
  return (v, path) => {
    if (absent(v)) return opts.required ? bad(path, 'is required') : ok<T>(undefined);
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) return bad(path, `must be one of: ${allowed.join(', ')}`);
    return ok(v as T);
  };
}

/** `keepLast` trims over-long history (e.g. chat transcripts) to the most recent items instead of rejecting the request. */
export function list<T>(item: Validator<T>, opts: { max: number; required?: boolean; keepLast?: boolean }): Validator<T[]> {
  return (v, path) => {
    if (absent(v)) return opts.required ? bad(path, 'is required') : ok<T[]>(undefined);
    if (!Array.isArray(v)) return bad(path, 'must be an array');
    if (v.length > opts.max && !opts.keepLast) return bad(path, `must have at most ${opts.max} items`);
    const items = v.length > opts.max ? v.slice(-opts.max) : v;
    const out: T[] = [];
    const issues: string[] = [];
    items.forEach((el, i) => {
      const r = item(el, `${path}[${i}]`);
      if (!r.ok) issues.push(...r.issues);
      else out.push(r.value as T);
    });
    return issues.length ? { ok: false, issues } : ok(out);
  };
}

interface LooseOpts {
  maxKeys?: number;
  maxDepth?: number;
  maxString?: number;
  maxArray?: number;
  required?: boolean;
  /** Restrict the top-level type. */
  kind?: 'object' | 'array' | 'any';
}

/**
 * For nested app objects (profile, session, plan ...) whose exact shape the existing clients own. Keeps the data but
 * bounds depth, key count, array length and string length, and strips control characters, so it cannot be used to
 * smuggle oversized or pathological input into a prompt.
 */
export function loose(opts: LooseOpts = {}): Validator<unknown> {
  const { maxKeys = 80, maxDepth = 6, maxString = 2000, maxArray = 500 } = opts;
  const walk = (v: unknown, path: string, depth: number, issues: string[]): unknown => {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) issues.push(`${path}: must be finite`);
      return v;
    }
    if (typeof v === 'string') {
      const s = v.replace(CONTROL, '').replace(FENCE_TAG, '');
      if (s.length > maxString) issues.push(`${path}: must be at most ${maxString} characters`);
      return s;
    }
    if (depth >= maxDepth) {
      issues.push(`${path}: is nested too deeply`);
      return undefined;
    }
    if (Array.isArray(v)) {
      if (v.length > maxArray) {
        issues.push(`${path}: must have at most ${maxArray} items`);
        return undefined;
      }
      return v.map((el, i) => walk(el, `${path}[${i}]`, depth + 1, issues));
    }
    if (typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length > maxKeys) {
        issues.push(`${path}: has too many fields`);
        return undefined;
      }
      const out: Record<string, unknown> = {};
      for (const [k, val] of entries) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        out[k] = walk(val, `${path}.${k}`, depth + 1, issues);
      }
      return out;
    }
    issues.push(`${path}: unsupported value`);
    return undefined;
  };
  return (v, path) => {
    if (absent(v)) return opts.required ? bad(path, 'is required') : ok<unknown>(undefined);
    const kind = opts.kind ?? 'any';
    if (kind === 'object' && (typeof v !== 'object' || Array.isArray(v))) return bad(path, 'must be an object');
    if (kind === 'array' && !Array.isArray(v)) return bad(path, 'must be an array');
    const issues: string[] = [];
    const value = walk(v, path, 0, issues);
    return issues.length ? { ok: false, issues } : ok(value);
  };
}

export function object(shape: Record<string, Validator<any>>, refine?: (value: Record<string, unknown>) => string[]): Schema {
  return (v, path) => {
    const body = absent(v) ? {} : v;
    if (typeof body !== 'object' || Array.isArray(body)) return bad(path, 'must be a JSON object');
    const out: Record<string, unknown> = {};
    const issues: string[] = [];
    for (const [key, validator] of Object.entries(shape)) {
      const r = validator((body as Record<string, unknown>)[key], key);
      if (!r.ok) issues.push(...r.issues);
      else if (r.value !== undefined) out[key] = r.value;
    }
    if (!issues.length && refine) issues.push(...refine(out));
    return issues.length ? { ok: false, issues } : ok(out);
  };
}

/* ---------------- file payloads (extract-plan) ---------------- */

export const EXTRACT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv'] as const;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // decoded bytes
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function base64DecodedLength(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

/** Returns an issue string, or null when the decoded head matches the declared MIME type. */
export function checkFileSignature(b64: string, mime: string): string | null {
  const head = Buffer.from(b64.slice(0, 64), 'base64');
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  switch (mime) {
    case 'application/pdf':
      return startsWith(0x25, 0x50, 0x44, 0x46, 0x2d) ? null : 'content does not look like a PDF';
    case 'image/png':
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ? null : 'content does not look like a PNG image';
    case 'image/jpeg':
      return startsWith(0xff, 0xd8, 0xff) ? null : 'content does not look like a JPEG image';
    case 'image/webp':
      return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP' ? null : 'content does not look like a WebP image';
    default: {
      const sample = Buffer.from(b64.slice(0, 1368), 'base64');
      return sample.includes(0) ? 'content does not look like text' : null;
    }
  }
}

const fileData: Validator<string> = (v, path) => {
  if (absent(v)) return ok<string>(undefined);
  if (typeof v !== 'string') return bad(path, 'must be a base64 string');
  if (v.length === 0) return bad(path, 'must not be empty');
  if (v.length % 4 !== 0 || !BASE64.test(v)) return bad(path, 'is not valid base64 (send raw base64 without a data: prefix)');
  if (base64DecodedLength(v) > MAX_FILE_BYTES) return bad(path, `must decode to at most ${MAX_FILE_BYTES / (1024 * 1024)} MB`);
  return ok(v);
};

/* ---------------- request schemas ---------------- */

const t = (max: number, extra: { required?: boolean; min?: number; allowNumber?: boolean; truncate?: boolean } = {}) => text({ max, ...extra });
const profile = loose({ kind: 'object' });

export const schemas = {
  extractPlan: object(
    {
      text: t(200_000),
      fileData,
      mimeType: oneOf(EXTRACT_MIME_TYPES),
      fileName: t(255)
    },
    (b) => {
      const issues: string[] = [];
      if (b.fileData) {
        if (!b.mimeType) issues.push('mimeType: is required when fileData is provided');
        else {
          const sig = checkFileSignature(b.fileData as string, b.mimeType as string);
          if (sig) issues.push(`fileData: ${sig}`);
        }
      } else if (!b.text) {
        issues.push('fileData: provide either fileData with mimeType, or text');
      }
      return issues;
    }
  ),
  generatePlan: object({
    goal: t(200),
    split: t(100),
    daysPerWeek: num({ min: 1, max: 7, int: true }),
    equipment: t(500),
    experience: t(100),
    injuries: t(1000),
    specialRequests: t(1000)
  }),
  exerciseCoach: object({
    exerciseName: t(200, { required: true }),
    equipment: t(100),
    targetReps: t(30, { allowNumber: true }),
    targetRir: t(20, { allowNumber: true }),
    notes: t(1000)
  }),
  generateAiRoutine: object({
    muscleRecoveryData: loose({ kind: 'array', maxArray: 60 }),
    availableEquipment: loose({ kind: 'array', maxArray: 40 }),
    recentEquipmentUsed: loose({ kind: 'array', maxArray: 40 }),
    equipmentNotes: t(1000),
    trainingSplitFocus: t(100),
    sessionDurationMinutes: num({ min: 5, max: 300 }),
    targetExerciseCount: num({ min: 1, max: 30, int: true }),
    experienceLevel: t(50),
    primaryGoal: t(100),
    injuriesOrDeload: t(1000)
  }),
  foodParser: object({ query: t(500, { required: true }), mealCategory: t(40) }),
  workoutInsights: object({ session: loose({ kind: 'object', required: true }), profile }),
  planOverloadTuning: object({ plan: loose({ kind: 'object', required: true }), profile, historySummary: loose({ maxString: 5000 }) }),
  nutritionCoach: object({ profile: loose({ kind: 'object', required: true }), recentWeightTrend: loose({ maxArray: 400 }) }),
  recoveryInsights: object({ sessions: loose({ kind: 'array', maxArray: 1000 }), profile, activePlan: loose({ kind: 'object' }) }),
  personalTrainer: object(
    {
      messages: list(object({ role: t(20), text: t(8000, { required: true, truncate: true }) }), { max: 40, keepLast: true }),
      userMessage: t(2000),
      profile,
      activeSession: loose({ kind: 'object' }),
      recovery: loose({ kind: 'object' }),
      bluetooth: loose({ kind: 'object' })
    },
    (b) => (!b.userMessage && !(Array.isArray(b.messages) && b.messages.length) ? ['userMessage: is required'] : [])
  ),
  // The handler runs the existing validateCoachingContext(); this layer only bounds the envelope.
  adaptiveCoachExplain: object({ context: loose({ kind: 'object', required: true, maxKeys: 120, maxDepth: 8, maxArray: 1000 }) }),
  formAnalyzer: object({ exerciseName: t(200, { required: true }), userQuestion: t(1000), experience: t(50), goal: t(100) }),
  warmupGenerator: object({
    muscleGroups: list(t(80), { max: 20 }),
    exercises: list(t(120), { max: 40 }),
    workoutName: t(120),
    intensity: t(30)
  }),
  generatePhysique: object({
    archetype: t(60),
    customPrompt: t(1000),
    targetBodyFat: num({ min: 3, max: 60 }),
    muscleEmphasis: list(t(40), { max: 12 }),
    gender: t(20)
  }),
  physiqueAnalysis: object({ dreamPhysique: loose({ kind: 'object', required: true }), currentProfile: loose({ kind: 'object' }) })
};

/** Runs the endpoint schema (from the policy table) and replaces req.body with the sanitised value. */
export function validateBody(schema: Schema | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!schema) return next();
    const r = schema(req.body, 'body');
    if (!r.ok) {
      const err = new ApiError(400, 'invalid_request', 'The request was invalid. ' + r.issues.slice(0, 5).join('; '));
      return next(err);
    }
    req.body = r.value;
    next();
  };
}
