import type { PrimaryGoal, TrainingExperience, TrainingPhase, UserProfile } from '../../types';

interface Option<T extends string> {
  value: T;
  /** Full label for selects. */
  label: string;
  /** Compact label for badges. */
  short: string;
}

export const GOAL_OPTIONS: Option<PrimaryGoal>[] = [
  { value: 'muscle_gain', label: 'Muscle Gain (Hypertrophy)', short: 'Muscle gain' },
  { value: 'fat_loss', label: 'Fat Loss (Deficit)', short: 'Fat loss' },
  { value: 'recomposition', label: 'Body Recomposition', short: 'Recomposition' },
  { value: 'maintenance', label: 'Maintenance & Strength', short: 'Maintenance' }
];

export const EXPERIENCE_OPTIONS: Option<TrainingExperience>[] = [
  { value: 'beginner', label: 'Beginner (< 1 year)', short: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate (1-4 years)', short: 'Intermediate' },
  { value: 'advanced', label: 'Advanced (4+ years)', short: 'Advanced' }
];

export const PHASE_OPTIONS: Option<TrainingPhase>[] = [
  { value: 'hypertrophy', label: 'Hypertrophy (Progressive)', short: 'Hypertrophy' },
  { value: 'strength', label: 'Strength (Lower reps)', short: 'Strength' },
  { value: 'adaptation', label: 'Adaptation (Conservative)', short: 'Adaptation' },
  { value: 're_entry', label: 'Re-Entry (Recovery)', short: 'Re-entry' },
  { value: 'deload', label: 'Deload (-25% load)', short: 'Deload' }
];

export const SEX_OPTIONS: { value: UserProfile['sex']; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'unspecified', label: 'Unspecified' }
];

export const shortLabel = <T extends string>(options: Option<T>[], value: T): string | undefined =>
  options.find((o) => o.value === value)?.short;
