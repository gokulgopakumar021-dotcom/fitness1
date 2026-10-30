import { FeedbackCategory, FeedbackSeverity, FormObservation } from '../../types/workoutMirror';

export interface ActiveFeedbackItem {
  id: string;
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  message: string;
  timestamp: number;
  expiresAt: number;
  highlightJoints?: number[];
}

export interface FeedbackEngineOptions {
  cooldownMs?: number;
  positiveCooldownMs?: number;
}

export class FeedbackEngine {
  private cooldownMs: number;
  private positiveCooldownMs: number;
  private lastMessageTimestamps = new Map<string, number>();
  private activeItem: ActiveFeedbackItem | null = null;
  private history: FormObservation[] = [];

  constructor(options: FeedbackEngineOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? 3500;
    this.positiveCooldownMs = options.positiveCooldownMs ?? 5000;
  }

  processObservations(
    incoming: FormObservation[],
    currentTimeMs: number
  ): { active: ActiveFeedbackItem | null; newSpeechCue?: string } {
    // Record all observations in historical ledger
    for (const obs of incoming) {
      this.history.push(obs);
    }

    // Filter incoming by cooldown
    const eligible = incoming.filter((obs) => {
      if (!this.lastMessageTimestamps.has(obs.message)) return true;
      const lastTime = this.lastMessageTimestamps.get(obs.message)!;
      const cooldown = obs.category === 'positive' ? this.positiveCooldownMs : this.cooldownMs;
      return currentTimeMs - lastTime >= cooldown;
    });

    if (eligible.length === 0) {
      // Check if current active item has expired (lasts 3 seconds)
      if (this.activeItem && currentTimeMs > this.activeItem.expiresAt) {
        this.activeItem = null;
      }
      return { active: this.activeItem };
    }

    // Rank candidates by severity priority:
    // 1. tracking / camera issues
    // 2. error / warning corrections
    // 3. info corrections
    // 4. positive feedback
    const rankObservation = (obs: FormObservation): number => {
      if (obs.category === 'tracking') return 40;
      if (obs.severity === 'error') return 30;
      if (obs.severity === 'warning') return 20;
      if (obs.severity === 'info') return 10;
      return 5; // positive
    };

    eligible.sort((a, b) => rankObservation(b) - rankObservation(a));
    const winner = eligible[0];

    this.lastMessageTimestamps.set(winner.message, currentTimeMs);

    this.activeItem = {
      id: winner.id,
      category: winner.category,
      severity: winner.severity,
      message: winner.message,
      timestamp: currentTimeMs,
      expiresAt: currentTimeMs + 3200,
      highlightJoints: winner.highlightJoints,
    };

    return {
      active: this.activeItem,
      newSpeechCue: winner.message,
    };
  }

  getActiveItem(): ActiveFeedbackItem | null {
    return this.activeItem;
  }

  getHistory(): FormObservation[] {
    return [...this.history];
  }

  getObservationsSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const item of this.history) {
      summary[item.message] = (summary[item.message] ?? 0) + 1;
    }
    return summary;
  }

  clear(): void {
    this.lastMessageTimestamps.clear();
    this.activeItem = null;
    this.history = [];
  }
}
