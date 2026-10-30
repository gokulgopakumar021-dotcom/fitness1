export type VoiceCoachingFrequency = 'all' | 'corrections_only' | 'milestones_only';

export class VoiceCoach {
  private isEnabled: boolean = true;
  private frequency: VoiceCoachingFrequency = 'all';
  private rate: number = 1.05;
  private pitch: number = 1.0;
  private isSpeaking: boolean = false;
  private speechQueue: string[] = [];

  constructor(enabled: boolean = true) {
    this.isEnabled = enabled;
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  getEnabled(): boolean {
    return this.isEnabled;
  }

  setFrequency(freq: VoiceCoachingFrequency): void {
    this.frequency = freq;
  }

  getFrequency(): VoiceCoachingFrequency {
    return this.frequency;
  }

  speakRepCount(repNumber: number): void {
    if (!this.isEnabled || !this.isSupported()) return;
    if (this.frequency === 'corrections_only') return;

    this.speak(repNumber.toString(), true);
  }

  speakCorrection(message: string): void {
    if (!this.isEnabled || !this.isSupported()) return;
    if (this.frequency === 'milestones_only') return;

    // Simplify message for concise voice delivery
    let cue = message;
    if (message.includes('!')) {
      cue = message.split('!')[0];
    }
    this.speak(cue, false);
  }

  speakMilestone(text: string): void {
    if (!this.isEnabled || !this.isSupported()) return;
    if (this.frequency === 'corrections_only') return;

    this.speak(text, true);
  }

  speak(text: string, interrupt: boolean = false): void {
    if (!this.isEnabled || !this.isSupported() || !text.trim()) return;

    try {
      const synth = window.speechSynthesis;
      if (interrupt) {
        synth.cancel();
        this.speechQueue = [];
      }

      const UtteranceClass =
        typeof SpeechSynthesisUtterance !== 'undefined'
          ? SpeechSynthesisUtterance
          : typeof window !== 'undefined'
          ? (window as any).SpeechSynthesisUtterance
          : null;
      if (!UtteranceClass) return;

      const utterance = new UtteranceClass(text);
      utterance.rate = this.rate;
      utterance.pitch = this.pitch;

      utterance.onstart = () => {
        this.isSpeaking = true;
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        if (this.speechQueue.length > 0) {
          const next = this.speechQueue.shift();
          if (next) this.speak(next, false);
        }
      };

      utterance.onerror = () => {
        this.isSpeaking = false;
      };

      if (synth.speaking && !interrupt) {
        // Limit queue length to 1 item to avoid falling behind
        if (this.speechQueue.length < 2) {
          this.speechQueue.push(text);
        }
      } else {
        synth.speak(utterance);
      }
    } catch {
      // SpeechSynthesis may throw in background tab or restricted iframes; safely fail silent
    }
  }

  stop(): void {
    this.speechQueue = [];
    this.isSpeaking = false;
    if (this.isSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }
}

export const globalVoiceCoach = new VoiceCoach(true);
