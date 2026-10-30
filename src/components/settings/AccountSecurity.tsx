import React, { useState } from 'react';
import { Button, Card, Input, Modal, SectionHeading } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { validateConfirm, validatePassword } from '../../utils/authValidation';
import { eraseAccountLocalData } from '../../storage/resetAll';

export const DELETE_CONFIRM_WORD = 'DELETE';

/** Password change, sign-out-everywhere and permanent account deletion. Rendered only when signed in. */
export const AccountSecurity: React.FC = () => {
  const { user, changePassword, signOutOtherDevices, deleteAccount, signOut } = useAuth();

  // --- change password ---
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwErrors, setPwErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [pwBusy, setPwBusy] = useState(false);
  const [pwStatus, setPwStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwStatus(null);
    const errors = {
      current: current ? undefined : 'Enter your current password.',
      next: validatePassword(next) ?? (next === current && current ? 'Choose a password different from your current one.' : undefined),
      confirm: validateConfirm(next, confirm) ?? undefined
    };
    setPwErrors(errors);
    if (errors.current || errors.next || errors.confirm) return;
    setPwBusy(true);
    const r = await changePassword(current, next);
    setPwBusy(false);
    if (r.ok) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setPwStatus({ ok: true, text: 'Password updated.' });
    } else {
      setPwStatus({ ok: false, text: r.error ?? 'Could not update your password.' });
    }
  };

  // --- sign out other devices ---
  const [othersBusy, setOthersBusy] = useState(false);
  const [othersStatus, setOthersStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const runSignOutOthers = async () => {
    setOthersBusy(true);
    setOthersStatus(null);
    const r = await signOutOtherDevices();
    setOthersBusy(false);
    setOthersStatus(r.ok ? { ok: true, text: 'Signed out of all other devices.' } : { ok: false, text: r.error ?? 'Could not sign out other devices.' });
  };

  // --- delete account ---
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState('');
  const [deleteWord, setDeleteWord] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canDelete = deletePw.length > 0 && deleteWord === DELETE_CONFIRM_WORD && !deleteBusy;

  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleteOpen(false);
    setDeletePw('');
    setDeleteWord('');
    setDeleteError(null);
  };

  const runDelete = async () => {
    if (!canDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const r = await deleteAccount(deletePw);
    if (!r.ok) {
      setDeleteError(r.error ?? 'Your account could not be deleted.');
      setDeleteBusy(false);
      return;
    }
    // The cloud account is gone. Now remove this account's data from this device, then end the local session.
    try {
      await eraseAccountLocalData();
    } catch {
      /* best effort: the account itself is already deleted */
    }
    await signOut();
  };

  if (!user) return null;

  return (
    <Card as="section" aria-labelledby="security-heading" className="space-y-5">
      <SectionHeading level={3} title="Password & security" description={`Signed in as ${user.email}`} />
      <span id="security-heading" className="sr-only">
        Password and security
      </span>

      <form onSubmit={submitPassword} className="space-y-3" noValidate>
        <h4 className="text-sm font-medium text-zinc-100">Change password</h4>
        <Input type="password" label="Current password" autoComplete="current-password" value={current} error={pwErrors.current} onChange={(e) => setCurrent(e.target.value)} />
        <Input type="password" label="New password" autoComplete="new-password" value={next} error={pwErrors.next} onChange={(e) => setNext(e.target.value)} />
        <Input type="password" label="Confirm new password" autoComplete="new-password" value={confirm} error={pwErrors.confirm} onChange={(e) => setConfirm(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={pwBusy}>
            Update password
          </Button>
          {pwStatus && (
            <p role={pwStatus.ok ? 'status' : 'alert'} className={`text-xs ${pwStatus.ok ? 'text-accent' : 'text-danger'}`}>
              {pwStatus.text}
            </p>
          )}
        </div>
      </form>

      <div className="border-t border-line pt-4 space-y-2">
        <h4 className="text-sm font-medium text-zinc-100">Other devices</h4>
        <p className="text-label text-zinc-500">Ends your sign-in on every other browser and device. This one stays signed in.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" loading={othersBusy} onClick={runSignOutOthers}>
            Sign out other devices
          </Button>
          {othersStatus && (
            <p role={othersStatus.ok ? 'status' : 'alert'} className={`text-xs ${othersStatus.ok ? 'text-accent' : 'text-danger'}`}>
              {othersStatus.text}
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-line pt-4 space-y-2">
        <h4 className="text-sm font-medium text-danger">Delete account</h4>
        <p className="text-label text-zinc-500">
          Permanently deletes your Iron Log account and removes this account's data from this device. Data saved on other
          devices stays there until you sign in on them and erase it. This cannot be undone.
        </p>
        <Button type="button" variant="danger" onClick={() => setDeleteOpen(true)}>
          Delete account…
        </Button>
      </div>

      <Modal
        open={deleteOpen}
        onClose={closeDelete}
        title="Delete your account?"
        description="This permanently deletes your account and the data stored on this device for it."
        size="sm"
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeDelete} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={runDelete} disabled={!canDelete} loading={deleteBusy}>
              Delete my account
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Input type="password" label="Your password" autoComplete="current-password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} />
          <Input
            label={`Type ${DELETE_CONFIRM_WORD} to confirm`}
            value={deleteWord}
            onChange={(e) => setDeleteWord(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
          />
          {deleteError && (
            <p role="alert" className="text-xs text-danger">
              {deleteError}
            </p>
          )}
        </div>
      </Modal>
    </Card>
  );
};
