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

  // If already on the trainer tab, no need to show the floating button
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
      <div className="fixed bottom-20 lg:bottom-6 right-4 sm:right-6 z-40">
        {!isOpen ? (
          <button
            onClick={() => setIsOpen(true)}
            className="touch-press flex items-center gap-2 px-3.5 py-2.5 bg-zinc-900/95 hover:bg-zinc-800 border-2 border-lime-400/60 hover:border-lime-400 text-zinc-100 rounded-full shadow-2xl backdrop-blur-md transition-all group"
            title="Ask Coach Iron (AI Fitness Trainer)"
          >
            <div className="w-6 h-6 rounded-full bg-lime-400/20 text-lime-400 flex items-center justify-center font-bold text-xs">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold font-mono tracking-tight group-hover:text-lime-300">
              AI Coach
            </span>
            {activeSession && (
              <span className="w-2 h-2 rounded-full bg-lime-400 animate-ping" />
            )}
          </button>
        ) : (
          /* Expanded Quick Coach Drawer */
          <div className="bg-[#0b0f14] border-2 border-lime-400/60 rounded-2xl p-4 shadow-2xl w-80 sm:w-96 space-y-3 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-lime-400/20 text-lime-400 flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-zinc-100 font-mono">
                    COACH IRON &middot; QUICK ASSIST
                  </h4>
                  {activeSession && (
                    <span className="text-[10px] text-lime-400 font-mono block">
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
                  className="text-[10px] text-lime-400 hover:underline font-mono font-bold mr-1"
                >
                  Full View &rarr;
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 text-zinc-400 hover:text-zinc-100 rounded"
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
                  className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded text-[11px] font-mono"
                >
                  {p}
                </button>
              ))}
            </div>

            {quickReply && (
              <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 max-h-40 overflow-y-auto leading-relaxed">
                <p className="whitespace-pre-line">{quickReply}</p>
              </div>
            )}

            <div className="flex gap-1.5 pt-1">
              <input
                type="text"
                value={quickQuestion}
                onChange={(e) => setQuickQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleQuickAsk();
                }}
                placeholder="Ask coach during workout..."
                className="flex-1 px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-lime-400"
              />
              <button
                onClick={() => handleQuickAsk()}
                disabled={isLoading}
                className="px-3 py-1.5 bg-lime-400 hover:bg-lime-300 text-black font-bold text-xs rounded-xl disabled:opacity-50 shrink-0"
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
