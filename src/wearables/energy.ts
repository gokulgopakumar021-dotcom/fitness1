/**
 * Heart-rate based active-energy ESTIMATE (Keytel et al. 2005, sex-specific, for steady aerobic exercise).
 * It is an estimate, not a measurement, and is only produced when age, body weight and sex are real profile values:
 * there are no default ages or weights and no one-formula-fits-all. Returns null otherwise (never a guess).
 */
export interface EnergyInput { bpm: number; age?: number | null; weightKg?: number | null; sex?: string | null }

export function estimateActiveKcalPerMinute({ bpm, age, weightKg, sex }: EnergyInput): number | null {
  if (!Number.isFinite(bpm) || bpm <= 90 || bpm > 255) return null;
  if (typeof age !== 'number' || !Number.isFinite(age) || age < 10 || age > 100) return null;
  if (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg < 25 || weightKg > 300) return null;
  let kj: number;
  if (sex === 'male') kj = -55.0969 + 0.6309 * bpm + 0.1988 * weightKg + 0.2017 * age;
  else if (sex === 'female') kj = -20.4022 + 0.4472 * bpm - 0.1263 * weightKg + 0.074 * age;
  else return null;
  return Math.max(0, kj / 4.184);
}
