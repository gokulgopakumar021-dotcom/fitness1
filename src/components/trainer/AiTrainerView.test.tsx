import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiTrainerView } from './AiTrainerView';
import { DEFAULT_PROFILE } from '../../storage/db';
import { UserProfile, WorkoutSession } from '../../types';
import { BluetoothGadgetProvider } from '../../context/BluetoothGadgetContext';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const mockProfile: UserProfile = {
  ...DEFAULT_PROFILE,
  name: 'Marcus Vance',
  currentWeightKg: 82.0,
  goalWeightKg: 78.0,
  preferredUnit: 'kg',
  dailyCalorieTarget: 2400,
  dailyProteinTarget: 180,
  trainingSplitName: 'Upper / Lower',
  trainingPhase: 'hypertrophy'
};

const renderTrainer = async (overrides: Partial<React.ComponentProps<typeof AiTrainerView>> = {}) => {
  const props = {
    profile: mockProfile,
    activeSession: null,
    onNavigate: vi.fn(),
    onProfileUpdated: vi.fn(),
    ...overrides
  };

  await act(async () => {
    root.render(
      <BluetoothGadgetProvider profile={props.profile}>
        <AiTrainerView {...props} />
      </BluetoothGadgetProvider>
    );
  });

  return props;
};

describe('AiTrainerView Component', () => {
  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders Coach Iron header, AI Coach badge, and initial greeting', async () => {
    await renderTrainer();

    expect(container.textContent).toContain('Coach Iron');
    expect(container.textContent).toContain('AI Coach');
    expect(container.textContent).toContain('Greetings, Marcus Vance!');
  });

  it('renders the 4 quick access toolkit buttons', async () => {
    await renderTrainer();

    expect(container.textContent).toContain('Adaptive Review');
    expect(container.textContent).toContain('5-Min Dynamic Warm-up');
    expect(container.textContent).toContain('Physique Blueprint');
    expect(container.textContent).toContain('Posture & Form Cues');
  });

  it('renders quick coach prompt chips', async () => {
    await renderTrainer();

    expect(container.textContent).toContain('Start 5-min pre-workout warm-up');
    expect(container.textContent).toContain('Visualize dream physique & diet blueprint');
    expect(container.textContent).toContain('Preview squat posture & knee angles');
  });

  it('toggles voice readout button aria-pressed state', async () => {
    await renderTrainer();

    const voiceBtn = container.querySelector('button[aria-label="Enable voice read-out"]');
    expect(voiceBtn).toBeDefined();

    await act(async () => {
      voiceBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const activeVoiceBtn = container.querySelector('button[aria-label="Mute AI voice output"]');
    expect(activeVoiceBtn).toBeDefined();
    expect(activeVoiceBtn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('displays active workout badge when session is active', async () => {
    const activeSession: WorkoutSession = {
      id: 'active-1',
      date: '2026-10-29',
      dayName: 'Upper Hypertrophy',
      startTime: new Date().toISOString(),
      status: 'in_progress',
      exercises: []
    };

    await renderTrainer({ activeSession });

    expect(container.textContent).toContain('Upper Hypertrophy');
  });
});
