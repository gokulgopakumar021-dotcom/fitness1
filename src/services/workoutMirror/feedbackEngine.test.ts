import { describe, it, expect } from 'vitest';
import { FeedbackEngine } from './feedbackEngine';
import { FormObservation } from '../../types/workoutMirror';

describe('FeedbackEngine', () => {
  it('prioritizes safety warnings over positive feedback', () => {
    const engine = new FeedbackEngine({ cooldownMs: 3000, positiveCooldownMs: 5000 });

    const obs1: FormObservation = {
      id: 'pos-1',
      category: 'positive',
      severity: 'positive',
      message: 'Great tempo!',
      timestamp: 1000,
    };

    const obs2: FormObservation = {
      id: 'warn-1',
      category: 'correction',
      severity: 'warning',
      message: 'Knees caving inward! Push knees out.',
      timestamp: 1000,
    };

    const result = engine.processObservations([obs1, obs2], 1000);
    expect(result.active?.message).toBe('Knees caving inward! Push knees out.');
    expect(result.newSpeechCue).toBe('Knees caving inward! Push knees out.');
  });

  it('suppresses duplicate message within cooldown window', () => {
    const engine = new FeedbackEngine({ cooldownMs: 3500 });

    const obs: FormObservation = {
      id: 'warn-1',
      category: 'correction',
      severity: 'warning',
      message: 'Keep your chest proud.',
      timestamp: 1000,
    };

    // First appearance: accepted
    const res1 = engine.processObservations([obs], 1000);
    expect(res1.active?.message).toBe('Keep your chest proud.');

    // Second appearance 1000ms later: suppressed by cooldown
    const res2 = engine.processObservations([obs], 2000);
    expect(res2.newSpeechCue).toBeUndefined();

    // After cooldown period (4600ms): eligible again
    const res3 = engine.processObservations([obs], 4600);
    expect(res3.newSpeechCue).toBe('Keep your chest proud.');
  });

  it('maintains observation history and frequency summary', () => {
    const engine = new FeedbackEngine();

    const obs1: FormObservation = {
      id: '1',
      category: 'correction',
      severity: 'warning',
      message: 'Hips sagging!',
      timestamp: 1000,
    };

    const obs2: FormObservation = {
      id: '2',
      category: 'correction',
      severity: 'warning',
      message: 'Hips sagging!',
      timestamp: 5000,
    };

    engine.processObservations([obs1], 1000);
    engine.processObservations([obs2], 5000);

    const summary = engine.getObservationsSummary();
    expect(summary['Hips sagging!']).toBe(2);
  });
});
