/**
 * Body-area folders of the Video Library. `id` is the value stored in exercise_videos.muscle_groups (lowercase),
 * `label` is what the person sees. Keep in sync with supabase/manual/set_video_body_areas.sql.
 */
export interface VideoFolder {
  id: string;
  label: string;
}

export const VIDEO_FOLDERS: readonly VideoFolder[] = [
  { id: 'chest', label: 'Chest' },
  { id: 'back', label: 'Back' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'arms', label: 'Arms' },
  { id: 'legs', label: 'Legs' },
  { id: 'core', label: 'Core' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'stretching', label: 'Stretching' }
];

export const folderLabel = (id: string | null): string | null =>
  id === null ? null : (VIDEO_FOLDERS.find((f) => f.id === id)?.label ?? null);
