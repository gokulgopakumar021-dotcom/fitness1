import React, { useState } from 'react';
import { Button, Modal } from '../ui';
import { claimLegacyData, dismissLegacyPrompt, readLegacyWorkoutData } from '../../storage/legacyData';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface LegacyDataClaimProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful import so the surrounding screens re-read storage. */
  onClaimed?: () => void;
}

/**
 * Explicit, user-initiated import of workout data saved on this device before accounts existed.
 * It shows exactly what would be imported, never imports on its own, and leaves the original records untouched.
 */
export const LegacyDataClaim: React.FC<LegacyDataClaimProps> = ({ open, onClose, onClaimed }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const legacy = open ? readLegacyWorkoutData() : { plans: [], sessions: [], unreadable: false };

  const close = () => {
    if (busy) return;
    setError(null);
    setDone(null);
    onClose();
  };

  const notNow = () => {
    dismissLegacyPrompt();
    close();
  };

  const run = () => {
    setBusy(true);
    setError(null);
    const r = claimLegacyData();
    setBusy(false);
    if (r.ok) {
      setDone(r.message);
      onClaimed?.();
    } else {
      setError(r.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import workouts from before you signed in?"
      description="Workouts were found on this device that are not part of your account yet."
      size="sm"
      footer={
        done ? (
          <div className="flex justify-end w-full">
            <Button type="button" onClick={close}>Done</Button>
          </div>
        ) : (
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
            <Button type="button" variant="ghost" onClick={notNow} disabled={busy}>Not now</Button>
            <Button type="button" onClick={run} loading={busy} disabled={legacy.plans.length + legacy.sessions.length === 0}>
              Import into my account
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-3">
        {done ? (
          <p role="status" className="text-sm text-accent">{done}</p>
        ) : (
          <>
            <p className="text-sm text-zinc-300 leading-relaxed">
              Found on this device: <strong>{plural(legacy.plans.length, 'workout plan')}</strong> and{' '}
              <strong>{plural(legacy.sessions.length, 'logged workout')}</strong>.
            </p>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Importing merges them into your account without removing anything, and they will then sync to your other devices.
              The original data stays on this device untouched. You can also do this later from Settings.
            </p>
          </>
        )}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
};
