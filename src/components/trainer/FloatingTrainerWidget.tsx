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
      <div className="fixed bottom-20 lg:bottom-6 right-4 sm:right-6 z-40">
        {!isOpen ? (
          <button
            onClick={() => setIsOpen(true)}
            className="touch-press flex items-center gap-2 px-3.5 py-2.5 bg-black/90 hover:bg-zinc-950 border border-white/[0.1] hover:border-[#CEFF00]/50 text-white rounded-full shadow-2xl backdrop-blur-md transition-all group"
            title="Ask Coach Iron (AI Fitness Trainer)"
          >
            <div className="w-6 h-6 rounded-full bg-[#CEFF00]/20 text-[#CEFF00] flex items-center justify-center font-bold text-xs">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold font-mono tracking-tight group-hover:text-[#CEFF00]">
              Coach Iron
            </span>
            {activeSession && (
              <span className="w-2 h-2 rounded-full bg-[#CEFF00] animate-ping" />
            )}
          </button>
        ) : (
          /* Expanded Quick Coach Drawer */
          <div className="bg-[#0b0e14] border border-white/[0.1] rounded-3xl p-4 shadow-2xl w-80 sm:w-96 space-y-3 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-[#CEFF00]/20 text-[#CEFF00] flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-white font-mono">
                    COACH IRON · QUICK ASSIST
                  </h4>
                  {activeSession && (
                    <span className="text-[10px] text-[#CEFF00] font-mono block">
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
                  className="text-[10px] text-[#CEFF00] hover:underline font-mono font-bold mr-1"
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
                  className="px-2.5 py-1 bg-zinc-950 hover:bg-zinc-900 border border-white/[0.06] text-zinc-300 rounded-xl text-[11px] font-mono"
                >
                  {p}
                </button>
              ))}
            </div>

            {quickReply && (
              <div className="p-3 bg-zinc-950 border border-white/[0.06] rounded-2xl text-xs text-zinc-200 max-h-40 overflow-y-auto leading-relaxed">
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
                className="flex-1 bg-zinc-950 border border-white/[0.1] rounded-xl px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#CEFF00]"
              />
              <button
                onClick={() => handleQuickAsk()}
                disabled={isLoading || !quickQuestion.trim()}
                className="px-3 py-1.5 bg-[#CEFF00] hover:bg-[#d4ff00] disabled:opacity-40 text-black font-bold text-xs rounded-xl transition-colors font-nrc uppercase"
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
