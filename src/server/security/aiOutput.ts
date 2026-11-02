/**
 * Validation of structured model output before it is returned to a client (which stores it in local user data).
 * Unknown fields are dropped, strings are bounded, numbers are range-checked or defaulted to what the client already
 * defaults to. Returns a rejection (never a partially trusted object) when the structure is unusable.
 */
type PlanResult = { ok: true; plan: ExtractedPlan } | { ok: false; reason: string };

export interface ExtractedPlan {
  planName: string;
  trainingSplit: string;
  days: { dayName: string; exercises: ExtractedExercise[] }[];
}
export interface ExtractedExercise {
  name: string;
  muscleGroup?: string;
  equipment?: string;
  workingSets?: number;
  repRange?: string;
  targetRir?: number;
  restSeconds?: number;
  tempo?: string;
  notes?: string;
}

const MAX_DAYS = 14;
const MAX_EXERCISES = 40;

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return s ? s.slice(0, max) : undefined;
};
const numIn = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

export function validateExtractedPlan(raw: unknown): PlanResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not_object' };
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.days) || o.days.length === 0 || o.days.length > MAX_DAYS) return { ok: false, reason: 'days_invalid' };
  const days: ExtractedPlan['days'] = [];
  for (const d of o.days) {
    if (!d || typeof d !== 'object') return { ok: false, reason: 'day_invalid' };
    const dd = d as Record<string, unknown>;
    if (!Array.isArray(dd.exercises) || dd.exercises.length > MAX_EXERCISES) return { ok: false, reason: 'exercises_invalid' };
    const exercises: ExtractedExercise[] = [];
    for (const e of dd.exercises) {
      if (!e || typeof e !== 'object') return { ok: false, reason: 'exercise_invalid' };
      const ee = e as Record<string, unknown>;
      const name = str(ee.name, 120);
      if (!name) return { ok: false, reason: 'exercise_name_missing' };
      exercises.push({
        name,
        muscleGroup: str(ee.muscleGroup, 60),
        equipment: str(ee.equipment, 60),
        workingSets: numIn(ee.workingSets, 1, 20),
        repRange: str(ee.repRange, 20),
        targetRir: numIn(ee.targetRir, 0, 10),
        restSeconds: numIn(ee.restSeconds, 0, 900),
        tempo: str(ee.tempo, 20),
        notes: str(ee.notes, 500)
      });
    }
    days.push({ dayName: str(dd.dayName, 80) ?? `Day ${days.length + 1}`, exercises });
  }
  return { ok: true, plan: { planName: str(o.planName, 120) ?? 'Extracted Plan', trainingSplit: str(o.trainingSplit, 80) ?? 'Extracted Routine', days } };
}
