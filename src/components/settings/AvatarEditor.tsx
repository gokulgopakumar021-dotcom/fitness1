import React, { useRef, useState } from 'react';
import { User } from 'lucide-react';
import { Button } from '../ui';
import { clearAvatar, getAvatar, saveAvatar } from '../../storage/avatarStore';
import { AVATAR_ACCEPTED_TYPES, initialsFromName, processAvatarFile, validateAvatarFile } from '../../utils/avatarImage';

interface AvatarEditorProps {
  name: string;
}

/** Profile photo. Stays on this device; downsized and re-encoded in the browser (EXIF stripped). */
export const AvatarEditor: React.FC<AvatarEditorProps> = ({ name }) => {
  const [avatar, setAvatar] = useState<string | null>(() => getAvatar());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initials = initialsFromName(name);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    const problem = validateAvatarFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await processAvatarFile(file);
      if (!saveAvatar(dataUrl)) {
        setError('Your photo could not be saved on this device (storage may be full).');
      } else {
        setAvatar(dataUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image could not be used.');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = () => {
    clearAvatar();
    setAvatar(null);
    setError(null);
  };

  return (
    <div className="flex items-center gap-4">
      <div
        className="h-16 w-16 shrink-0 rounded-full overflow-hidden bg-surface-3 border border-line-strong flex items-center justify-center text-lg font-semibold text-zinc-200"
        aria-label={avatar ? 'Profile photo' : 'No profile photo'}
        role="img"
      >
        {avatar ? (
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : initials ? (
          <span aria-hidden>{initials}</span>
        ) : (
          <User className="h-6 w-6 text-zinc-400" aria-hidden />
        )}
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
            {avatar ? 'Change photo' : 'Add photo'}
          </Button>
          {avatar && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
        <p className="text-label text-zinc-500">Stored only on this device. Resized to a small square.</p>
        {error && (
          <p role="alert" className="text-label text-danger">
            {error}
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_ACCEPTED_TYPES.join(',')}
          onChange={onPick}
          className="hidden"
          aria-label="Choose profile photo"
          data-testid="avatar-file-input"
        />
      </div>
    </div>
  );
};
