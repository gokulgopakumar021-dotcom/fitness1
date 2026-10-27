/** Workout video library types. Catalog metadata only; video binaries live in private Storage. */

export type VideoReviewStatus = 'matched' | 'needs_review' | 'unmatched' | 'rejected';
export type VideoProcessingStatus = 'pending' | 'uploaded' | 'failed';
export type VideoMatchMethod = 'exact_key' | 'exact_name' | 'exact_alias' | 'fuzzy' | 'manual' | 'none';

/** One row of public.exercise_videos as the browser sees it (published rows only). */
export interface ExerciseVideo {
  id: string;
  contentSha256: string;
  originalFilename: string;
  title: string;
  exerciseKey: string | null;
  storageKey: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  equipment: string[];
  muscleGroups: string[];
  tags: string[];
  matchMethod: VideoMatchMethod;
  matchConfidence: number;
  reviewStatus: VideoReviewStatus;
  status: VideoProcessingStatus;
  sortOrder: number;
}

/** Entry of the exercise identity index that videos are matched against. */
export interface ExerciseIndexEntry {
  key: string;
  name: string;
  aliases: string[];
  /** Where the entry came from, so nothing is presented as more authoritative than it is. */
  source: 'biomechanics' | 'starter-plan';
}

export interface MatchCandidate {
  key: string;
  score: number;
}

export interface MatchResult {
  /** Set only when the video can be published for this exercise without human review. */
  exerciseKey: string | null;
  /** Best guess awaiting review (fuzzy, ambiguous or equipment-conflicting matches). Never shown to users. */
  suggestedKey: string | null;
  method: VideoMatchMethod;
  confidence: number;
  reviewStatus: VideoReviewStatus;
  /** Machine-readable reason for non-automatic outcomes, for the review report. */
  reason: 'ok' | 'ambiguous' | 'equipment_conflict' | 'fuzzy_only' | 'no_match' | 'empty_name';
  candidates: MatchCandidate[];
}

export type InventoryStatus =
  | 'ok'
  | 'duplicate'
  | 'invalid_mp4'
  | 'unsafe_path'
  | 'suspicious_ratio'
  | 'symlink'
  | 'size_mismatch'
  | 'too_large'
  | 'read_error'
  | 'skipped_non_mp4';

export type ProbeStatus = 'ok' | 'failed' | 'unavailable' | 'skipped';

/** One line of the inventory manifest (manifest.jsonl). */
export interface ManifestRecord {
  entryIndex: number;
  /** Path exactly as stored in the archive. It is only a label: it is never used to build a filesystem path. */
  entryName: string;
  originalFilename: string;
  crc32: number;
  declaredSize: number;
  status: InventoryStatus;
  detail?: string;
  sha256: string | null;
  sizeBytes: number | null;
  duplicateOf?: string;
  probe: ProbeStatus;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  title: string;
  match: MatchResult | null;
}
