import React, { useState } from 'react';
import { Bot, X, Send } from 'lucide-react';
import { UserProfile, WorkoutSession } from '../../types';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { NavTab } from '../layout/Navbar';
import { Badge, Button, Card } from '../ui';

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
    <div className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] lg:bottom-6 right-4 sm:right-6 z-40">
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="relative flex items-center justify-center gap-2 w-12 h-12 sm:w-auto sm:h-11 sm:px-4 bg-surface-2 hover:bg-surface-3 border border-line-strong hover:border-accent/60 text-white rounded-full shadow-xl shadow-black/40 transition-colors group"
          title="Ask Coach Iron (AI Fitness Trainer)"
          aria-label="Ask Coach Iron"
        >
          <Bot className="w-5 h-5 text-volt-adaptive" aria-hidden />
          <span className="hidden sm:inline text-sm font-semibold">Ask Coach</span>
          {activeSession && (
            <span
              className="absolute top-1 right-1 sm:static w-2 h-2 rounded-full bg-accent animate-pulse"
              aria-hidden
            />
          )}
        </button>
      ) : (
        /* Expanded Quick Coach Drawer */
        <Card
          pad="none"
          tone="raised"
          className="w-[calc(100vw-2rem)] sm:w-96 shadow-2xl p-4 space-y-3 border-line-strong il-sheet-up"
        >
          <div className="flex items-center justify-between pb-2 border-b border-line">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-control bg-accent/15 text-volt-adaptive flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-white truncate">
                  Coach Iron · Quick Assist
                </h4>
                {activeSession && (
                  <Badge tone="accent" className="mt-0.5 truncate max-w-[180px]">
                    Active: {activeSession.dayName}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onNavigate('trainer');
                }}
                className="text-xs text-volt-adaptive hover:underline font-mono font-bold mr-1 min-h-[36px] px-2 flex items-center"
              >
                Full View &rarr;
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white rounded-control hover:bg-surface-2 transition-colors"
                aria-label="Close quick assist"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Cues Prompts */}
          <div className="flex flex-wrap gap-1.5">
            {[
              'Form check cue',
              'Should I increase weight?',
              'Rest interval cue',
              'Substitute exercise'
            ].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setQuickQuestion(p);
                  handleQuickAsk(p);
                }}
                className="min-h-[30px] px-2.5 py-1 bg-surface-2 hover:bg-surface-3 border border-line text-zinc-300 hover:text-white rounded-control text-xs font-mono transition-colors"
              >
                {p}
              </button>
            ))}
          </div>

          {quickReply && (
            <div className="p-3 bg-surface-2 border border-line rounded-control text-xs text-zinc-200 max-h-44 overflow-y-auto leading-relaxed space-y-1">
              <div className="flex items-center justify-between text-label font-mono text-zinc-400">
                <span className="flex items-center gap-1 text-volt-adaptive font-semibold">
                  <Bot className="w-3 h-3" /> Coach Iron
                </span>
                <button
                  type="button"
                  onClick={() => setQuickReply(null)}
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  Dismiss
                </button>
              </div>
              <p className="whitespace-pre-line text-xs">{quickReply}</p>
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
              className="flex-1 bg-surface-2 border border-line rounded-control px-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-line-strong min-h-[38px]"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={isLoading || !quickQuestion.trim()}
              loading={isLoading}
              icon={<Send className="w-3 h-3" />}
              onClick={() => handleQuickAsk()}
            >
              Ask
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};
