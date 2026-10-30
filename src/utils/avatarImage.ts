export const AVATAR_SIZE_PX = 256;
export const AVATAR_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const AVATAR_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function validateAvatarFile(file: { type: string; size: number }): string | null {
  if (!(AVATAR_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return 'Choose a JPEG, PNG or WebP image.';
  }
  if (file.size > AVATAR_MAX_INPUT_BYTES) return 'That image is larger than 8 MB. Choose a smaller one.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/** Up to two initials from a display name; '' when there is no usable name (caller shows a neutral icon). */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Centre-crops to a square and downsizes to AVATAR_SIZE_PX, re-encoding as JPEG. Re-encoding through a canvas
 * also drops EXIF metadata (including GPS) from the original photo. Runs entirely in the browser.
 */
export async function processAvatarFile(file: File): Promise<string> {
  const problem = validateAvatarFile(file);
  if (problem) throw new Error(problem);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That image could not be read. Try a different one.');
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE_PX;
    canvas.height = AVATAR_SIZE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processing is not available in this browser.');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    bitmap.close?.();
  }
}
