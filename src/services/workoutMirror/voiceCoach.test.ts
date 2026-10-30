import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceCoach } from './voiceCoach';

class MockUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  onstart?: () => void;
  onend?: () => void;
  onerror?: () => void;
  constructor(text: string) {
    this.text = text;
  }
}

describe('VoiceCoach', () => {
  let mockSynth: any;

  beforeEach(() => {
    mockSynth = {
      speaking: false,
      speak: vi.fn(),
      cancel: vi.fn(),
    };

    Object.defineProperty(window, 'speechSynthesis', {
      value: mockSynth,
      writable: true,
      configurable: true,
    });
    (globalThis as any).speechSynthesis = mockSynth;
    (globalThis as any).SpeechSynthesisUtterance = MockUtterance;
    (window as any).SpeechSynthesisUtterance = MockUtterance;
  });

  it('honors enabled and disabled toggle', () => {
    const coach = new VoiceCoach(false);
    coach.speakRepCount(5);
    expect(mockSynth.speak).not.toHaveBeenCalled();

    coach.setEnabled(true);
    coach.speakRepCount(5);
    expect(mockSynth.speak).toHaveBeenCalled();
  });

  it('filters based on coaching frequency', () => {
    const coach = new VoiceCoach(true);
    coach.setFrequency('corrections_only');

    coach.speakRepCount(3);
    // Rep count filtered out under corrections_only
    expect(mockSynth.speak).not.toHaveBeenCalled();

    coach.speakCorrection('Knees caving inward!');
    expect(mockSynth.speak).toHaveBeenCalled();
  });

  it('stops and cancels active speech upon stop()', () => {
    const coach = new VoiceCoach(true);
    coach.speak('Keep moving');
    coach.stop();
    expect(mockSynth.cancel).toHaveBeenCalled();
  });
});
