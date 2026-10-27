/** Text normalization shared by the offline matcher and the in-app exercise lookup. */

/** Words that describe the file, not the exercise. */
const FILENAME_NOISE = new Set(['video', 'tutorial', 'hd', '1080p', '720p', '480p', 'male', 'female', 'mp4']);

/** Tokens that name equipment. Different families on both sides mean the exercise is a different movement variant. */
const EQUIPMENT_FAMILY: Record<string, string> = {
  barbell: 'barbell',
  ez: 'barbell',
  ezbar: 'barbell',
  dumbbell: 'dumbbell',
  db: 'dumbbell',
  cable: 'cable',
  machine: 'machine',
  smith: 'smith',
  kettlebell: 'kettlebell',
  band: 'band',
  bodyweight: 'bodyweight'
};

/** Strips a plural 's' conservatively: "curls" -> "curl", "press" and "glutes" handled, short words untouched. */
function stem(token: string): string {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')) {
    return token.slice(0, -1);
  }
  return token;
}

export function tokenize(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(stem);
}

/** Canonical comparison form of an exercise name, key or alias. */
export function normalizeExerciseText(text: string): string {
  return tokenize(text).join(' ');
}

export interface NormalizedFilename {
  normalized: string;
  tokens: string[];
  /** Trailing variant marker removed from the name ("_2", "(1)", "copy"), kept so the report can show it. */
  variant: string | null;
  title: string;
}

/** Normalizes a video filename (basename or path) to the same form as exercise names. */
export function normalizeVideoFilename(filename: string): NormalizedFilename {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  let stemmed = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');

  // Leading catalog number: "0012_barbell_curl", "12 - barbell curl".
  stemmed = stemmed.replace(/^\d+[\s._-]+/, '');

  // Trailing variant marker, only when separated from the name, so real names such as "21s" survive.
  let variant: string | null = null;
  const trailing = stemmed.match(/^(.+?)[\s._-]+(\(\d{1,2}\)|copy(?:\s*\d+)?|v\d{1,2}|\d{1,2})$/i);
  if (trailing) {
    stemmed = trailing[1];
    variant = trailing[2];
  }

  let tokens = tokenize(stemmed).filter((t) => !FILENAME_NOISE.has(t));
  // A name made only of digits ("0001.mp4") carries no exercise name at all.
  if (tokens.length > 0 && tokens.every((t) => /^\d+$/.test(t))) tokens = [];
  const title = stemmed
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { normalized: tokens.join(' '), tokens, variant, title: title || base };
}

export function equipmentFamilies(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) {
    const family = EQUIPMENT_FAMILY[t];
    if (family) out.add(family);
  }
  return out;
}

export function slugifyExerciseName(name: string): string {
  return tokenize(name).join('-');
}
