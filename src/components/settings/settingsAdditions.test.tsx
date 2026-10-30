import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({
  user: { email: 'me@example.com' } as { email: string } | null,
  changePassword: vi.fn(),
  signOutOtherDevices: vi.fn(),
  deleteAccount: vi.fn(),
  signOut: vi.fn()
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

const erase = vi.hoisted(() => ({ eraseAccountLocalData: vi.fn(async () => {}) }));
vi.mock('../../storage/resetAll', () => erase);

import { AccountSecurity } from './AccountSecurity';
import { NotificationSettings } from './NotificationSettings';
import { DataControls } from './DataControls';
import { HeightField } from './HeightField';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import { getReminderPrefs } from '../../storage/reminderPrefs';

let container: HTMLDivElement;
let root: Root;

const render = async (el: React.ReactElement) => { await act(async () => root.render(el)); };
const $ = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const byText = (sel: string, text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => e.textContent?.trim() === text) ?? null;
const click = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => (el as HTMLElement).click()); };
async function type(el: HTMLElement | null, value: string) {
  expect(el).not.toBeNull();
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const byLabel = (label: string) => {
  const l = Array.from(document.querySelectorAll('label')).find((e) => e.textContent?.trim().startsWith(label));
  return (l && document.getElementById(l.getAttribute('for') ?? '')) as HTMLInputElement | null;
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  auth.user = { email: 'me@example.com' };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('AccountSecurity: delete account', () => {
  const openDialog = async () => {
    await render(<AccountSecurity />);
    await click(byText('button', 'Delete account…'));
  };

  it('keeps the delete button disabled until the password and the word DELETE are both entered', async () => {
    await openDialog();
    const del = () => byText('button', 'Delete my account') as HTMLButtonElement;
    expect(del().disabled).toBe(true);
    await type(byLabel('Your password'), 'secret-pw');
    expect(del().disabled).toBe(true);
    await type(byLabel('Type DELETE'), 'delete');
    expect(del().disabled).toBe(true); // case-sensitive
    await type(byLabel('Type DELETE'), 'DELETE');
    expect(del().disabled).toBe(false);
  });

  it('on failure shows the error and does NOT erase local data or sign out', async () => {
    auth.deleteAccount.mockResolvedValue({ ok: false, error: 'That password is not correct.' });
    await openDialog();
    await type(byLabel('Your password'), 'wrong');
    await type(byLabel('Type DELETE'), 'DELETE');
    await click(byText('button', 'Delete my account'));
    expect(auth.deleteAccount).toHaveBeenCalledWith('wrong');
    expect(document.body.textContent).toContain('That password is not correct.');
    expect(erase.eraseAccountLocalData).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('on success erases this account\'s local data and then signs out locally', async () => {
    const order: string[] = [];
    auth.deleteAccount.mockResolvedValue({ ok: true });
    erase.eraseAccountLocalData.mockImplementation(async () => { order.push('erase'); });
    auth.signOut.mockImplementation(async () => { order.push('signOut'); return { ok: true }; });
    await openDialog();
    await type(byLabel('Your password'), 'right');
    await type(byLabel('Type DELETE'), 'DELETE');
    await click(byText('button', 'Delete my account'));
    expect(order).toEqual(['erase', 'signOut']);
  });

  it('renders nothing when signed out', async () => {
    auth.user = null;
    await render(<AccountSecurity />);
    expect(container.innerHTML).toBe('');
  });
});

describe('AccountSecurity: change password', () => {
  it('validates before calling the API', async () => {
    await render(<AccountSecurity />);
    await type(byLabel('Current password'), 'oldpass123');
    await type(byLabel('New password'), 'short');
    await type(byLabel('Confirm new password'), 'short');
    await act(async () => { $('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[role="alert"]').length).toBeGreaterThan(0);
  });

  it('rejects a mismatched confirmation and an unchanged password', async () => {
    await render(<AccountSecurity />);
    await type(byLabel('Current password'), 'oldpass123');
    await type(byLabel('New password'), 'newpass1234');
    await type(byLabel('Confirm new password'), 'different123');
    await act(async () => { $('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(auth.changePassword).not.toHaveBeenCalled();
    await type(byLabel('New password'), 'oldpass123');
    await type(byLabel('Confirm new password'), 'oldpass123');
    await act(async () => { $('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('submits valid input, clears the fields and confirms', async () => {
    auth.changePassword.mockResolvedValue({ ok: true });
    await render(<AccountSecurity />);
    await type(byLabel('Current password'), 'oldpass123');
    await type(byLabel('New password'), 'newpass1234');
    await type(byLabel('Confirm new password'), 'newpass1234');
    await act(async () => { $('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(auth.changePassword).toHaveBeenCalledWith('oldpass123', 'newpass1234');
    expect(container.textContent).toContain('Password updated.');
    expect(byLabel('Current password')!.value).toBe('');
  });
});

describe('NotificationSettings', () => {
  const stubNotification = (permission: NotificationPermission, requestResult: NotificationPermission = permission) => {
    const N = Object.assign(vi.fn(), { permission, requestPermission: vi.fn(async () => requestResult) });
    vi.stubGlobal('Notification', N);
    (window as unknown as { Notification: unknown }).Notification = N;
    return N;
  };

  it('asks for permission when a reminder is turned on, and enables it when granted', async () => {
    const N = stubNotification('default', 'granted');
    await render(<NotificationSettings />);
    await click($('input[aria-label="Workout reminder"]'));
    expect(N.requestPermission).toHaveBeenCalledTimes(1);
    expect(getReminderPrefs().workout.enabled).toBe(true);
  });

  it('leaves the reminder off when permission is declined', async () => {
    stubNotification('default', 'denied');
    await render(<NotificationSettings />);
    await click($('input[aria-label="Workout reminder"]'));
    expect(getReminderPrefs().workout.enabled).toBe(false);
    expect(container.textContent).toContain('blocked');
  });

  it('shows the blocked state and does not allow enabling when permission is already denied', async () => {
    stubNotification('denied');
    await render(<NotificationSettings />);
    expect(($('input[aria-label="Workout reminder"]') as HTMLInputElement).disabled).toBe(true);
    expect(($('input[aria-label="Meal logging reminder"]') as HTMLInputElement).disabled).toBe(true);
  });

  it('persists time and day changes immediately', async () => {
    stubNotification('granted');
    await render(<NotificationSettings />);
    await click($('input[aria-label="Workout reminder"]'));
    await type(byLabel('Remind me at'), '06:45');
    await click(byText('button', 'Sat'));
    const w = getReminderPrefs().workout;
    expect(w.time).toBe('06:45');
    expect(w.days).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('DataControls', () => {
  it('deletes a category only after confirmation and keeps the others', async () => {
    db.saveProfile({ ...DEFAULT_PROFILE });
    db.saveSleepLogs([{ id: 's1', date: '2026-10-27' } as never]);
    db.saveBodyMetrics([{ id: 'm1', date: '2026-10-27', weightKg: 80, bmi: 24 } as never]);
    await render(<DataControls />);
    const sleepRow = Array.from(container.querySelectorAll('li')).find((li) => li.textContent?.includes('Sleep logs'))!;
    await click(Array.from(sleepRow.querySelectorAll('button'))[0]);
    expect(db.getSleepLogs()).toHaveLength(1); // dialog open, nothing deleted yet
    await click(byText('button', 'Cancel'));
    expect(db.getSleepLogs()).toHaveLength(1);
    await click(Array.from(sleepRow.querySelectorAll('button'))[0]);
    await click(byText('button', 'Delete permanently'));
    expect(db.getSleepLogs()).toHaveLength(0);
    expect(db.getBodyMetrics()).toHaveLength(1);
    expect(container.textContent).toContain('Sleep logs deleted.');
  });
});

describe('HeightField', () => {
  it('converts feet and inches to cm on edit', async () => {
    const onChange = vi.fn();
    await render(<HeightField valueCm={0} unit="ft_in" onChange={onChange} />);
    await type($('input[aria-label="Feet"]'), '5');
    await type($('input[aria-label="Inches"]'), '10');
    expect(onChange).toHaveBeenLastCalledWith(177.8);
  });

  it('shows the stored cm value as feet and inches without emitting a change', async () => {
    const onChange = vi.fn();
    await render(<HeightField valueCm={182.9} unit="ft_in" onChange={onChange} />);
    expect(($('input[aria-label="Feet"]') as HTMLInputElement).value).toBe('6');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses a plain cm field by default', async () => {
    const onChange = vi.fn();
    await render(<HeightField valueCm={178} unit={undefined} onChange={onChange} />);
    expect(byLabel('Height (cm)')!.value).toBe('178');
    await type(byLabel('Height (cm)'), '180');
    expect(onChange).toHaveBeenLastCalledWith(180);
  });
});
