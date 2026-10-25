import React, { useState } from 'react';
import { Bot, Sparkles, X, MessageSquare, Dumbbell, ShieldCheck, Bluetooth } from 'lucide-react';
import { UserProfile, WorkoutSession } from '../../types';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { NavTab } from '../layout/Navbar';

interface FloatingTrainerWidgetProps {
  currentTab: NavTab;
  onNavigate: (tab: NavTab) => void;
  activeSession: WorkoutSession | null;
  profile: UserProfile;
}

export const FloatingTrainerWidget: React.FC<FloatingTrainerWidgetProps> = ({
  currentTab,
  onNavigate,
  activeSession,
  profile
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [quickQuestion, setQuickQuestion] = useState<string>('');
  const [quickReply, setQuickReply] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const { isConnected, liveHeartRate } = useBluetoothGadget();

  if (currentTab === 'trainer') return null;

  const handleQuickAsk = async (queryText?: string) => {
    const q = (queryText || quickQuestion).trim();
    if (!q || isLoading) return;

    setIsLoading(true);
    setQuickReply(null);

    try {
      const response = await fetch('/api/ai-personal-trainer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: q,
          profile,
          activeSession,
          bluetooth: { isConnected, bpm: liveHeartRate }
        })
      });

      const data = await response.json();
      setQuickReply(data.reply || 'Keep up solid intent and proper form!');
    } catch {
      setQuickReply('Focus on maintaining a solid core brace and full range of motion!');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating Trainer Button */}
      <div className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] lg:bottom-6 right-4 sm:right-6 z-40">
        {!isOpen ? (
          <button
            onClick={() => setIsOpen(true)}
            className="touch-press relative flex items-center justify-center gap-2 w-12 h-12 sm:w-auto sm:h-11 sm:px-4 bg-surface-2 hover:bg-surface-3 border border-line-strong hover:border-accent/60 text-[var(--text-primary)] rounded-full shadow-lg shadow-black/30 transition-colors group"
            title="Ask Coach Iron (AI Fitness Trainer)"
            aria-label="Ask Coach Iron"
          >
            <Bot className="w-5 h-5 text-volt-adaptive" aria-hidden />
            <span className="hidden sm:inline text-sm font-semibold">Ask Coach</span>
            {activeSession && (
              <span className="absolute top-1 right-1 sm:static w-2 h-2 rounded-full bg-accent" aria-hidden />
            )}
          </button>
        ) : (
          /* Expanded Quick Coach Drawer */
          <div className="bg-surface border border-line rounded-2xl p-4 shadow-2xl w-[calc(100vw-2rem)] sm:w-96 space-y-3 il-sheet-up">
            <div className="flex items-center justify-between pb-2 border-b border-line">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-accent/20 text-accent flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                    Coach Iron · Quick assist
                  </h4>
                  {activeSession && (
                    <span className="text-[11px] text-accent font-mono block">
                      Active: {activeSession.dayName}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onNavigate('trainer');
                  }}
                  className="text-[11px] text-accent hover:underline font-mono font-bold mr-1"
                >
                  Full View &rarr;
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 text-zinc-400 hover:text-white rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Quick Cues Prompts */}
            <div className="flex flex-wrap gap-1">
              {[
                'Form check cue',
                'Should I increase weight?',
                'Rest interval cue',
                'Substitute exercise'
              ].map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setQuickQuestion(p);
                    handleQuickAsk(p);
                  }}
                  className="px-2.5 py-1 bg-canvas hover:bg-surface-2 border border-line text-zinc-300 rounded-xl text-[11px] font-mono"
                >
                  {p}
                </button>
              ))}
            </div>

            {quickReply && (
              <div className="p-3 bg-canvas border border-line rounded-2xl text-xs text-zinc-200 max-h-40 overflow-y-auto leading-relaxed">
                <p className="whitespace-pre-line">{quickReply}</p>
              </div>
            )}

            <div className="flex items-center gap-1.5 pt-1">
              <input
                type="text"
                value={quickQuestion}
                onChange={(e) => setQuickQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleQuickAsk();
                  }
                }}
                placeholder="Ask quick cue..."
                className="flex-1 bg-canvas border border-line rounded-xl px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => handleQuickAsk()}
                disabled={isLoading || !quickQuestion.trim()}
                className="px-3 py-1.5 bg-accent hover:bg-accent disabled:opacity-40 text-accent-ink font-bold text-xs rounded-xl transition-colors font-nrc "
              >
                {isLoading ? '...' : 'Ask'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
