import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../common/RestTimer', async (orig) => {
  const real = await orig<typeof import('../common/RestTimer')>();
  return { ...real, playTimerChime: () => {} };
});

import { EntitlementProvider } from '../../context/EntitlementContext';
import { OPEN_BILLING_EVENT } from '../../lib/billingGate';
import type { BillingStatus } from '../../lib/billingApi';
import { WorkoutSessionTracker } from '../workouts/WorkoutSessionTracker';
import { NutritionView } from '../nutrition/NutritionView';
import { PlansUploadView } from '../plans/PlansUploadView';
import { AiRecoveryInsightsPanel } from '../dashboard/AiRecoveryInsightsPanel';
import { ExercisePostureModal } from '../posture/ExercisePostureModal';
import { DesktopSidebar, NAV_GROUPS } from '../layout/Navbar';
import { FloatingTrainerWidget } from '../trainer/FloatingTrainerWidget';
import { HomeExploreCard } from '../home/HomeSections';
import { BluetoothGadgetProvider } from '../../context/BluetoothGadgetContext';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import { getCurrentDayKey } from '../../storage/nutritionTargetCommit';
import type { LoggedSet, WorkoutSession } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const statusOf = (hasAccess: boolean, state = hasAccess ? 'trialing' : 'none'): BillingStatus => ({
  enforcement: 'on',
  emailVerified: true,
  trial: { eligible: true, days: 3, firstChargePreviewAt: null, verificationDebit: { amountPaise: 500, refundedAutomatically: true } },
  plans: [],
  entitlement: { state, hasAccess, accessEndsAt: null },
  subscription: null
});
const LOCKED = () => statusOf(false);
const ENTITLED = () => statusOf(true);

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let billingOpened: number;
const onOpenBilling = () => { billingOpened++; };

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (el: Element | undefined | null) => { expect(el, 'element to click').toBeTruthy(); await act(async () => (el as HTMLElement).click()); await flush(); };
const page = () => document.body.textContent ?? '';
const buttons = () => Array.from(document.body.querySelectorAll('button'));
const norm = (b: Element) => (b.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttonWithText = (text: string) => buttons().find((b) => norm(b).includes(text));
const byLabel = (label: string) => document.body.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
const lockCount = () => document.body.querySelectorAll('[data-premium-lock]').length;
const aiCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/') && !String(c[0]).includes('/api/billing/') && !String(c[0]).includes('/nutrition/barcode'));
const setValue = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const fieldByLabel = (text: string) => {
  const label = Array.from(document.body.querySelectorAll('label')).find((l) => (l.textContent ?? '').includes(text));
  expect(label, `label ${text}`).toBeTruthy();
  return (label!.htmlFor ? document.getElementById(label!.htmlFor) : label!.querySelector('input,textarea')) as HTMLInputElement | HTMLTextAreaElement;
};

/** Renders under the real provider with a fixed billing status and waits for it to load. */
const renderWith = async (status: BillingStatus, ui: React.ReactElement) => {
  await act(async () => root.render(<EntitlementProvider userId="u1" fetchStatus={async () => status}>{ui}</EntitlementProvider>));
  await flush();
};

beforeEach(() => {
  localStorage.clear();
  billingOpened = 0;
  window.addEventListener(OPEN_BILLING_EVENT, onOpenBilling);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  window.removeEventListener(OPEN_BILLING_EVENT, onOpenBilling);
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------------------------------------------------ workouts
const ts = () => new Date().toISOString();
const set = (id: string, n: number, completed: boolean): LoggedSet => ({ id, setNumber: n, type: 'working', weight: 80, reps: 8, rir: 2, completed, timestamp: ts() });
const session = (): WorkoutSession => ({
  id: 's1', dayName: 'Push A', date: '2026-10-29', startTime: new Date(Date.now() - 60000).toISOString(), status: 'in_progress',
  exercises: [{ id: 'e1', name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell', repRange: '6-8', targetRir: 2, restSeconds: 120, sets: [set('a1', 1, true), set('a2', 2, false)] }]
});
const Tracker: React.FC = () => {
  const [s, setS] = React.useState<WorkoutSession | null>(session());
  return (
    <BluetoothGadgetProvider profile={DEFAULT_PROFILE}>
      <WorkoutSessionTracker profile={DEFAULT_PROFILE} activeSession={s} onSessionUpdated={setS} onNavigateToPlans={() => {}} />
    </BluetoothGadgetProvider>
  );
};

describe('workout tracker', () => {
  it('locked: AI Coach and warm-up show Premium, tapping opens billing and runs nothing, basic tracking still works', async () => {
    db.saveActiveSession(session());
    await renderWith(LOCKED(), <Tracker />);
    expect(norm(buttonWithText('AI Coach')!)).toContain('Premium');

    await click(buttonWithText('AI Coach'));
    expect(billingOpened).toBe(1);
    expect(aiCalls()).toHaveLength(0);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    await click(byLabel('5-minute warm-up (Premium)'));
    expect(billingOpened).toBe(2);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(aiCalls()).toHaveLength(0);

    await click(byLabel('Complete set 2'));
    expect(page()).toContain('2/2 sets');
    expect(db.getActiveSession()!.exercises[0].sets[1].completed).toBe(true);
    expect(billingOpened).toBe(2);
  });

  it('entitled: no lock is shown and AI Coach opens as before', async () => {
    db.saveActiveSession(session());
    await renderWith(ENTITLED(), <Tracker />);
    expect(lockCount()).toBe(0);
    await click(buttonWithText('AI Coach'));
    expect(billingOpened).toBe(0);
    expect(aiCalls().some((c) => String(c[0]).includes('/api/exercise-coach'))).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------ nutrition
const nutritionProfile = { ...DEFAULT_PROFILE, sex: 'male' as const, age: 30, heightCm: 180, currentWeightKg: 80, dailyCalorieTarget: 2500, dailyProteinTarget: 150, dailyCarbsTarget: 300, dailyFatTarget: 70, onboardingCompleted: true };

describe('nutrition', () => {
  it('locked: the AI Parser tab shows Premium and opens billing; manual food logging stays free', async () => {
    await renderWith(LOCKED(), <NutritionView profile={nutritionProfile} />);
    await click(document.body.querySelector('[aria-label^="Add food to "]'));
    expect(norm(buttonWithText('AI Parser')!)).toContain('Premium');

    await click(buttonWithText('AI Parser'));
    expect(billingOpened).toBe(1);
    expect(page()).not.toContain('Extract Macros');
    expect(aiCalls()).toHaveLength(0);

    await click(document.body.querySelector('[aria-label^="Add custom food to "]'));
    await setValue(fieldByLabel('Food or dish name') as HTMLInputElement, 'Homemade curry');
    await setValue(fieldByLabel('Calories (kcal)') as HTMLInputElement, '420');
    await click(buttonWithText('Save & Log Entry'));
    expect(db.getNutritionLogForDate(getCurrentDayKey()).entries.map((e) => [e.name, e.calories])).toEqual([['Homemade curry', 420]]);
    expect(billingOpened).toBe(1);
  });

  it('entitled: the AI Parser tab opens normally with no lock', async () => {
    await renderWith(ENTITLED(), <NutritionView profile={nutritionProfile} />);
    await click(document.body.querySelector('[aria-label^="Add food to "]'));
    expect(lockCount()).toBe(0);
    await click(buttonWithText('AI Parser'));
    expect(page()).toContain('Extract Macros');
    expect(billingOpened).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------ routines
const planProps = { profile: DEFAULT_PROFILE, onPlanActivated: () => {}, onNavigateToProgression: () => {}, onStartWorkout: () => {} };
const upload = async (file: File) => {
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await flush();
};

describe('routines', () => {
  it('locked: both AI builder buttons show Premium and open billing instead of the builder', async () => {
    await renderWith(LOCKED(), <PlansUploadView {...planProps} />);
    expect(norm(buttonWithText('AI builder')!)).toContain('Premium');
    expect(norm(buttonWithText('Launch AI builder')!)).toContain('Premium');
    await click(buttonWithText('Launch AI builder'));
    await click(buttons().find((b) => norm(b).startsWith('AI builder')));
    expect(billingOpened).toBe(2);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(aiCalls()).toHaveLength(0);
  });

  it('locked: a PDF/image/TXT upload (AI extraction) is not sent, but CSV import stays free and local', async () => {
    await renderWith(LOCKED(), <PlansUploadView {...planProps} />);
    await upload(new File(['%PDF'], 'routine.pdf', { type: 'application/pdf' }));
    expect(billingOpened).toBe(1);
    expect(aiCalls()).toHaveLength(0);
    expect(db.getUploadedDocs()).toHaveLength(0);

    await upload(new File(['Day,Exercise,Sets,Reps\nPush,Bench Press,3,8-10\n'], 'plan.csv', { type: 'text/csv' }));
    expect(billingOpened).toBe(1);
    expect(db.getUploadedDocs()).toHaveLength(1);
  });

  it('entitled: no lock is shown and the AI builder opens', async () => {
    await renderWith(ENTITLED(), <PlansUploadView {...planProps} />);
    expect(lockCount()).toBe(0);
    await click(buttonWithText('Launch AI builder'));
    expect(billingOpened).toBe(0);
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------------ dashboard, form coach, navigation, widget
describe('AI recovery analysis', () => {
  const panel = <AiRecoveryInsightsPanel profile={DEFAULT_PROFILE} recentSessions={[]} activePlan={null} onNavigate={() => {}} />;
  it('locked: shows Premium, does not call the AI, opens billing', async () => {
    await renderWith(LOCKED(), panel);
    expect(norm(buttonWithText('Run AI Recovery Analysis')!)).toContain('Premium');
    await click(buttonWithText('Run AI Recovery Analysis'));
    expect(billingOpened).toBe(1);
    expect(aiCalls()).toHaveLength(0);
  });
  it('entitled: unchanged', async () => {
    await renderWith(ENTITLED(), panel);
    expect(lockCount()).toBe(0);
    await click(buttonWithText('Run AI Recovery Analysis'));
    expect(billingOpened).toBe(0);
    expect(aiCalls().some((c) => String(c[0]).includes('/api/ai-recovery-insights'))).toBe(true);
  });
});

describe('form & biomechanics modal', () => {
  it('locked: only the AI Form Coach tab is premium; the diagram tabs stay free', async () => {
    const onClose = vi.fn();
    await renderWith(LOCKED(), <ExercisePostureModal exerciseName="Barbell Back Squat" isOpen onClose={onClose} />);
    expect(norm(buttonWithText('AI Form Coach')!)).toContain('Premium');
    expect(norm(buttonWithText('Step Checkpoints')!)).not.toContain('Premium');

    await click(buttonWithText('Step Checkpoints'));
    expect(onClose).not.toHaveBeenCalled();
    expect(billingOpened).toBe(0);

    await click(buttonWithText('AI Form Coach'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(billingOpened).toBe(1);
    expect(aiCalls()).toHaveLength(0);
  });
});

describe('navigation and widget', () => {
  it('locked: only AI Coach, Workout Mirror and Video Library carry the Premium lock in the sidebar', async () => {
    await renderWith(LOCKED(), <DesktopSidebar currentTab="home" onSelectTab={() => {}} activeSession={null} />);
    const locked = buttons().filter((b) => norm(b).includes('Premium')).map(norm);
    expect(locked).toEqual(['Workout MirrorPremium', 'Video LibraryPremium', 'AI CoachPremium']);
    expect(NAV_GROUPS.flatMap((g) => g.items)).toContain('trainer');
  });

  it('entitled: the sidebar shows no lock', async () => {
    await renderWith(ENTITLED(), <DesktopSidebar currentTab="home" onSelectTab={() => {}} activeSession={null} />);
    expect(lockCount()).toBe(0);
  });

  it('locked: Home "More" list marks Workout Mirror and Exercise videos only, and still routes through onNavigate', async () => {
    const onNavigate = vi.fn();
    await renderWith(LOCKED(), <HomeExploreCard onNavigate={onNavigate} />);
    expect(buttons().filter((b) => norm(b).includes('Premium')).map((b) => norm(b).split(' Premium')[0].replace(/Premium.*/, ''))).toHaveLength(2);
    expect(norm(buttonWithText('Workout Mirror')!)).toContain('Premium');
    expect(norm(buttonWithText('Exercise videos')!)).toContain('Premium');
    expect(norm(buttonWithText('Overview')!)).not.toContain('Premium');
    await click(buttonWithText('Workout Mirror'));
    expect(onNavigate).toHaveBeenCalledWith('mirror'); // App.navigate() turns this into billing while locked
  });

  it('locked: the Ask Coach button is marked Premium and does not open the drawer', async () => {
    await renderWith(LOCKED(), <BluetoothGadgetProvider profile={DEFAULT_PROFILE}><FloatingTrainerWidget currentTab="home" onNavigate={() => {}} activeSession={null} profile={DEFAULT_PROFILE} /></BluetoothGadgetProvider>);
    const btn = byLabel('Ask Coach Iron (Premium)');
    expect(btn).toBeTruthy();
    await click(btn);
    expect(billingOpened).toBe(1);
    expect(page()).not.toContain('Quick Assist');
    expect(aiCalls()).toHaveLength(0);
  });
});
