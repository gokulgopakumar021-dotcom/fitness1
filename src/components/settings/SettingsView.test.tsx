import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({
  user: { email: 'me@example.com' } as { email: string } | null,
  signOut: vi.fn(async () => ({ ok: true })),
  changePassword: vi.fn(),
  signOutOtherDevices: vi.fn(),
  deleteAccount: vi.fn()
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

const reset = vi.hoisted(() => ({
  resetAllAppData: vi.fn(async () => {}),
  eraseAccountLocalData: vi.fn(async () => {})
}));
vi.mock('../../storage/resetAll', () => reset);

import { SettingsView } from './SettingsView';
import { ThemeProvider } from '../../context/ThemeContext';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import type { UserProfile } from '../../types';

let container: HTMLDivElement;
let root: Root;

const onProfileUpdated = vi.fn();
const onLoadDemoData = vi.fn();
const onClearDemoData = vi.fn();

const view = (profile: UserProfile) => (
  <ThemeProvider>
    <SettingsView
      profile={profile}
      onProfileUpdated={onProfileUpdated}
      isDemoMode={false}
      onLoadDemoData={onLoadDemoData}
      onClearDemoData={onClearDemoData}
    />
  </ThemeProvider>
);
const render = async (profile: UserProfile = { ...DEFAULT_PROFILE, name: 'Alex' }) => {
  await act(async () => root.render(view(profile)));
};

/** Mirrors App: the parent owns the profile and feeds saved changes back down. */
const Stateful: React.FC<{ initial: UserProfile }> = ({ initial }) => {
  const [p, setP] = React.useState(initial);
  return (
    <ThemeProvider>
      <SettingsView
        profile={p}
        onProfileUpdated={(n) => {
          onProfileUpdated(n);
          setP(n);
        }}
        isDemoMode={false}
        onLoadDemoData={onLoadDemoData}
        onClearDemoData={onClearDemoData}
      />
    </ThemeProvider>
  );
};
const renderStateful = async (profile: UserProfile = { ...DEFAULT_PROFILE, name: 'Alex' }) => {
  await act(async () => root.render(<Stateful initial={profile} />));
};

const text = () => container.textContent ?? '';
const byText = (sel: string, label: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => e.textContent?.trim() === label) ?? null;
const click = async (el: Element | null) => {
  expect(el, 'element to click').not.toBeNull();
  await act(async () => (el as HTMLElement).click());
};
const go = (label: string) => click(byText('nav button', label));
const byLabel = (label: string) => {
  const l = Array.from(document.querySelectorAll('label')).find((e) => e.textContent?.trim().startsWith(label));
  return (l && document.getElementById(l.getAttribute('for') ?? '')) as HTMLInputElement | null;
};
async function type(el: HTMLElement | null, value: string) {
  expect(el, 'input to type into').not.toBeNull();
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  auth.user = { email: 'me@example.com' };
  document.documentElement.className = 'dark';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Settings layout and navigation', () => {
  it('shows the saved identity and the categories, with Profile first', async () => {
    await render({ ...DEFAULT_PROFILE, name: 'Alex', primaryGoal: 'fat_loss', trainingDaysPerWeek: 5 });
    expect(text()).toContain('Alex');
    expect(text()).toContain('Signed in as me@example.com');
    expect(text()).toContain('Fat loss');
    expect(text()).toContain('5 days/week');
    const labels = Array.from(document.querySelectorAll('nav[aria-label="Settings categories"] button')).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Profile', 'Training', 'Units', 'Appearance', 'Notifications', 'Privacy & data', 'Account']);
    expect(document.querySelector('nav[aria-label="Settings categories"] [aria-current="true"]')?.textContent).toContain('Profile');
    expect(text()).toContain('Personal information');
  });

  it('does not invent a name when none is stored', async () => {
    await render({ ...DEFAULT_PROFILE, name: '' });
    expect(text()).toContain('Add your name');
  });

  it('hides Account and sign-out when there is no signed-in user', async () => {
    auth.user = null;
    await render();
    expect(byText('nav button', 'Account')).toBeNull();
    expect(byText('button', 'Sign out')).toBeNull();
  });

  it('switches panels and keeps every control working per panel', async () => {
    await render();
    await go('Training');
    expect(text()).toContain('Progression engine');
    await go('Units');
    expect(text()).toContain('Measurement units');
    await go('Notifications');
    expect(text()).toContain('Reminders appear as browser notifications');
    await go('Privacy & data');
    expect(text()).toContain('Export & backup');
    expect(text()).toContain('Delete specific data');
    await go('Account');
    expect(text()).toContain('Change password');
  });

  it('signs out from the overview', async () => {
    await render();
    await click(byText('button', 'Sign out'));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('Profile editing', () => {
  it('flags unsaved changes, keeps them across panels, and discards them', async () => {
    await render();
    expect(text()).not.toContain('unsaved changes');
    await type(byLabel('Age'), '31');
    expect(text()).toContain('You have unsaved changes.');
    await go('Units');
    await go('Profile');
    expect(byLabel('Age')?.value).toBe('31');
    await click(byText('button', 'Discard'));
    expect(byLabel('Age')?.value).toBe(String(DEFAULT_PROFILE.age));
    expect(text()).not.toContain('unsaved changes');
  });

  it('saves valid edits to storage and reports success', async () => {
    await renderStateful();
    await type(byLabel('Age'), '31');
    await click(byText('button', 'Save changes'));
    expect(db.getProfile().age).toBe(31);
    expect(onProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({ age: 31 }));
    expect(text()).toContain('Preferences saved.');
    expect(text()).not.toContain('unsaved changes');
  });

  it('blocks an invalid edit with an inline message and writes nothing', async () => {
    await render();
    await type(byLabel('Age'), '5');
    await click(byText('button', 'Save changes'));
    expect(text()).toContain('Enter an age between 10 and 100.');
    expect(text()).toContain('Fix 1 field to save.');
    expect(db.getProfile().age).toBe(DEFAULT_PROFILE.age);
    expect(onProfileUpdated).not.toHaveBeenCalled();
    await type(byLabel('Age'), '30');
    expect(text()).not.toContain('Enter an age between');
  });

  it('jumps to the panel holding the first invalid field when saving from another panel', async () => {
    await render();
    await go('Training');
    await type(byLabel('Calories'), '20000');
    await go('Units');
    await click(byText('button', 'Save changes'));
    expect(text()).toContain('Daily targets');
    expect(text()).toContain('Enter 0 to 10,000 kcal.');
    expect(onProfileUpdated).not.toHaveBeenCalled();
  });

  it('can save an untouched older profile that holds out-of-range values for other fields', async () => {
    const odd = { ...DEFAULT_PROFILE, name: 'Alex', age: 8 };
    await render(odd);
    await type(byLabel('Name'), 'Alexa');
    await click(byText('button', 'Save changes'));
    expect(db.getProfile().name).toBe('Alexa');
    expect(db.getProfile().age).toBe(8);
  });

  it('saves the weight unit and height unit chosen in Units', async () => {
    await render();
    await go('Units');
    await click(byText('button', 'Pounds (lbs)'));
    await click(byText('button', 'Feet & inches'));
    await click(byText('button', 'Save changes'));
    expect(db.getProfile()).toMatchObject({ preferredUnit: 'lbs', heightUnit: 'ft_in' });
  });

  it('follows a unit change made elsewhere (header toggle) without showing unsaved changes', async () => {
    await render({ ...DEFAULT_PROFILE, name: 'Alex', preferredUnit: 'kg' });
    await render({ ...DEFAULT_PROFILE, name: 'Alex', preferredUnit: 'lbs' });
    expect(text()).not.toContain('unsaved changes');
    await go('Units');
    expect(byText('button', 'Pounds (lbs)')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Appearance', () => {
  it('switches the theme through ThemeContext', async () => {
    await render();
    await go('Appearance');
    expect(byText('button', 'Dark')?.getAttribute('aria-pressed')).toBe('true');
    await click(byText('button', 'Light'));
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(localStorage.getItem('ironlog_athlete_theme')).toBe('light');
    expect(byText('button', 'Light')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Privacy & data', () => {
  it('confirms before a full reset, and cancelling leaves data alone', async () => {
    await render();
    await go('Privacy & data');
    await click(byText('button', 'Reset All Data'));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Reset Entire Database?');
    await click(byText('button', 'Cancel'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(reset.resetAllAppData).not.toHaveBeenCalled();
  });

  it('resets after confirmation and refreshes the profile', async () => {
    await render();
    await go('Privacy & data');
    await click(byText('button', 'Reset All Data'));
    await click(byText('button', 'Yes, Delete All'));
    expect(reset.resetAllAppData).toHaveBeenCalledTimes(1);
    expect(onProfileUpdated).toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the failure and keeps the dialog open when the reset fails', async () => {
    reset.resetAllAppData.mockRejectedValueOnce(new Error('Body Scan data could not be deleted.'));
    await render();
    await go('Privacy & data');
    await click(byText('button', 'Reset All Data'));
    await click(byText('button', 'Yes, Delete All'));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Nothing was reset.');
    expect(onProfileUpdated).not.toHaveBeenCalled();
  });

  it('wires the demo dataset buttons', async () => {
    await render();
    await go('Privacy & data');
    await click(byText('button', 'Load demo dataset'));
    expect(onLoadDemoData).toHaveBeenCalledTimes(1);
  });

  it('runs the verification tests and lists results', async () => {
    await render();
    await go('Privacy & data');
    await click(byText('button', 'Run tests'));
    expect(text()).not.toContain('No results yet.');
    expect(text()).toMatch(/Passed|Failed/);
  });
});
