import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, Modal, SectionHeading } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { validateConfirm, validatePassword } from '../../utils/authValidation';
import { eraseAccountLocalData } from '../../storage/resetAll';
import { BillingApiError, fetchDeletionCheck, prepareDeletion, type DeletionCheck } from '../../lib/billingApi';
import { formatDate, planName } from '../../utils/billingPresentation';
import { OPEN_BILLING_EVENT } from '../../lib/billingGate';

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
  // Billing must be stopped before an account with a subscription can be deleted. This is a preview only: the server cancels at Razorpay
  // when you confirm, and the database refuses deletion until Razorpay has confirmed it. If the preview cannot be loaded (billing not set
  // up, offline), deletion proceeds exactly as before and the database gate is the safety net.
  const [billingCheck, setBillingCheck] = useState<DeletionCheck | null>(null);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const loadBillingCheck = useCallback(async () => {
    try {
      setBillingCheck(await fetchDeletionCheck());
    } catch {
      setBillingCheck(null);
    }
  }, []);
  useEffect(() => {
    if (!deleteOpen) return;
    let live = true;
    fetchDeletionCheck().then(
      (c) => live && setBillingCheck(c),
      () => live && setBillingCheck(null)
    );
    return () => {
      live = false;
    };
  }, [deleteOpen]);
  const requires = billingCheck?.requires ?? 'none';
  const canDelete = deletePw.length > 0 && deleteWord === DELETE_CONFIRM_WORD && !deleteBusy && (requires !== 'confirm_cancel_paid' || confirmPaid);

  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleteOpen(false);
    setDeletePw('');
    setDeleteWord('');
    setDeleteError(null);
    setConfirmPaid(false);
  };

  /** Runs after the password check and before deletion. Resolves ok only when Razorpay has confirmed every subscription stopped. */
  const stopBilling = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await prepareDeletion(requires === 'confirm_cancel_paid' && confirmPaid);
      if (r.ready) return { ok: true };
      return {
        ok: false,
        error: r.requires === 'confirm_cancel_paid' ? 'Please confirm that your subscription will be cancelled now.' : 'We could not confirm that your subscription has stopped. Nothing was removed.'
      };
    } catch (e) {
      return { ok: false, error: e instanceof BillingApiError ? `${e.message} Nothing was removed.` : 'We could not stop your subscription. Nothing was removed. Check your connection and try again.' };
    }
  };

  const runDelete = async () => {
    if (!canDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const r = requires === 'none' ? await deleteAccount(deletePw) : await deleteAccount(deletePw, stopBilling);
    if (!r.ok) {
      setDeleteError(r.error ?? 'Your account could not be deleted.');
      setDeleteBusy(false);
      if (r.code === 'billing_cancellation_required' || requires !== 'none') void loadBillingCheck(); // show what is now required
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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-testid="account-billing-link">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-zinc-100">Subscription</h4>
          <p className="text-xs text-zinc-400">Your plan, trial, billing history and cancellation.</p>
        </div>
        <Button variant="secondary" onClick={() => window.dispatchEvent(new Event(OPEN_BILLING_EVENT))}>
          Manage billing
        </Button>
      </div>

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
          Permanently deletes your IronLog AI account and removes this account's data from this device. Data saved on other
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
          {requires === 'cancel_billing' && (
            <p role="note" className="text-xs text-zinc-300 rounded-lg border border-line bg-zinc-900/40 p-3">
              You have a subscription set up. Deleting your account cancels it first, so you will not be billed again.
            </p>
          )}
          {requires === 'confirm_cancel_paid' && (
            <div role="note" className="space-y-2 rounded-lg border border-danger/30 bg-zinc-900/40 p-3">
              <p className="text-xs text-zinc-200">
                Your {billingCheck?.subscription ? `${planName(billingCheck.subscription.planKey)} ` : ''}subscription is paid
                {billingCheck?.accessEndsAt ? ` until ${formatDate(billingCheck.accessEndsAt)}` : ''}. Deleting your account cancels it immediately: paid access ends now and the
                current period is not refunded.
              </p>
              <label className="flex items-start gap-3 text-xs text-zinc-200 cursor-pointer min-h-[44px]">
                <input type="checkbox" checked={confirmPaid} onChange={(e) => setConfirmPaid(e.target.checked)} className="mt-0.5 accent-[var(--chart-1)]" />
                <span>I understand my subscription will be cancelled now, with no refund.</span>
              </label>
            </div>
          )}
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
