import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Send,
  Volume2,
  VolumeX,
  RotateCcw,
  Bot,
  User,
  ShieldCheck,
  Dumbbell,
  Heart,
  Bluetooth,
  ArrowRight,
  Flame,
  Activity,
  Layers,
  ChevronRight,
  ClipboardCheck
} from 'lucide-react';
import { UserProfile, WorkoutSession } from '../../types';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { ExercisePostureModal } from '../posture/ExercisePostureModal';
import { DynamicWarmupModal } from './DynamicWarmupModal';
import { DreamPhysiqueModal } from './DreamPhysiqueModal';
import { AdaptiveReviewModal } from './AdaptiveReviewModal';
import { NavTab } from '../layout/Navbar';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  suggestedAction?: {
    type: 'preview_posture' | 'open_bluetooth' | 'navigate_workouts' | 'navigate_progression' | 'dynamic_warmup' | 'dream_physique';
    payload?: string;
    label: string;
  };
}

interface AiTrainerViewProps {
  profile: UserProfile;
  activeSession: WorkoutSession | null;
  onNavigate: (tab: NavTab) => void;
  onProfileUpdated?: (updated: UserProfile) => void;
}

export const AiTrainerView: React.FC<AiTrainerViewProps> = ({
  profile,
  activeSession,
  onNavigate,
  onProfileUpdated
}) => {
  const { isConnected, device, liveHeartRate, setIsGadgetModalOpen } = useBluetoothGadget();
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      role: 'model',
      text: `Greetings, ${profile.name || 'Athlete'}! I'm Coach Iron, your personal AI fitness and biomechanics coach.

I'm linked into your active routine (${activeSession ? activeSession.dayName : profile.trainingSplitName || 'Custom Split'}) and your training goals (${profile.primaryGoal || 'Muscle Gain'}).

How can I coach you today? You can generate a 5-minute pre-workout dynamic warm-up, create your dream physique photo with AI to get a tailored diet and workout blueprint, or inspect real-time posture cues!`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      suggestedAction: {
        type: 'dream_physique',
        label: 'Create Dream Body Photo & Blueprint'
      }
    }
  ]);

  const [inputText, setInputText] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isSpeechEnabled, setIsSpeechEnabled] = useState<boolean>(false);
  const [postureModalExercise, setPostureModalExercise] = useState<string | null>(null);
  const [isWarmupModalOpen, setIsWarmupModalOpen] = useState<boolean>(false);
  const [isDreamPhysiqueModalOpen, setIsDreamPhysiqueModalOpen] = useState<boolean>(false);
  const [isAdaptiveReviewOpen, setIsAdaptiveReviewOpen] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const speakText = (text: string) => {
    if (!isSpeechEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const clean = text.replace(/[*_#`]/g, '');
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Speech synthesis error ignored
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || isSending) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsSending(true);

    try {
      const response = await fetch('/api/ai-personal-trainer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, text: m.text })),
          userMessage: text,
          profile,
          activeSession,
          bluetooth: { isConnected, bpm: liveHeartRate }
        })
      });

      const data = await response.json();
      const aiReplyText = data.reply || "Keep proper lifting cadence and drive through your heels!";

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'model',
        text: aiReplyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedAction: data.suggestedAction
      };

      setMessages((prev) => [...prev, aiMsg]);
      speakText(aiReplyText);
    } catch {
      const fallbackMsg: ChatMessage = {
        id: `ai-err-${Date.now()}`,
        role: 'model',
        text: "I'm temporarily offline from cloud servers, but remember: adhere to double progression, rest 2-3 minutes between compound sets, and hit your daily protein quotas!",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setIsSending(false);
    }
  };

  const handleActionClick = (action: ChatMessage['suggestedAction']) => {
    if (!action) return;
    switch (action.type) {
      case 'preview_posture':
        setPostureModalExercise(action.payload || 'Barbell Back Squat');
        break;
      case 'open_bluetooth':
        setIsGadgetModalOpen(true);
        break;
      case 'navigate_workouts':
        onNavigate('workouts');
        break;
      case 'navigate_progression':
        onNavigate('progression');
        break;
      case 'dynamic_warmup':
        setIsWarmupModalOpen(true);
        break;
      case 'dream_physique':
        setIsDreamPhysiqueModalOpen(true);
        break;
    }
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-11rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-9rem)] min-h-[480px] max-w-5xl mx-auto space-y-4">
      {/* TRAINER HEADER */}
      <div className="bg-surface border border-line rounded-2xl p-3 sm:p-4 shrink-0 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center text-accent shrink-0">
            <Bot className="w-5 h-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight leading-tight">Coach Iron</h1>
            <p className="text-xs text-zinc-400 mt-0.5 truncate">
              <span className="sm:hidden">AI fitness trainer</span>
              <span className="hidden sm:inline">
                AI fitness trainer · form cues, warm-ups, physique blueprints and live gadget data
              </span>
            </p>
          </div>
        </div>

        {/* Telemetry pills & controls */}
        <div className="flex items-center gap-2 text-xs shrink-0">
          {isConnected && device && (
            <button
              type="button"
              onClick={() => setIsGadgetModalOpen(true)}
              className="flex items-center gap-1.5 h-9 px-2.5 bg-info/10 border border-info/30 text-info rounded-lg hover:bg-info/20 transition-colors tabular"
              aria-label="Open Bluetooth gadgets"
            >
              <Bluetooth className="w-3.5 h-3.5" aria-hidden />
              <span>{liveHeartRate ? `${liveHeartRate} BPM` : 'Connected'}</span>
            </button>
          )}

          {activeSession && (
            <button
              type="button"
              onClick={() => onNavigate('workouts')}
              className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors"
            >
              <Dumbbell className="w-3.5 h-3.5" aria-hidden />
              <span className="truncate max-w-[120px]">{activeSession.dayName}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const next = !isSpeechEnabled;
              setIsSpeechEnabled(next);
              if (!next && typeof window !== 'undefined' && window.speechSynthesis) {
                window.speechSynthesis.cancel();
              }
            }}
            aria-pressed={isSpeechEnabled}
            aria-label={isSpeechEnabled ? 'Mute AI voice output' : 'Enable voice read-out'}
            className={`w-10 h-10 flex items-center justify-center rounded-lg border transition-colors ${
              isSpeechEnabled
                ? 'bg-accent text-accent-ink border-accent'
                : 'bg-surface-2 border-line text-zinc-400 hover:text-zinc-200'
            }`}
            title={isSpeechEnabled ? 'Mute AI voice output' : 'Enable voice read-out for hands-free training'}
          >
            {isSpeechEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => {
              if (window.confirm('Reset conversation with Coach Iron?')) {
                setMessages([
                  {
                    id: 'reset',
                    role: 'model',
                    text: `Fresh slate, ${profile.name || 'Athlete'}! What movement or training challenge shall we tackle next?`,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  }
                ]);
              }
            }}
            className="w-10 h-10 flex items-center justify-center bg-surface-2 hover:bg-surface-3 border border-line text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors"
            title="Reset chat"
            aria-label="Reset chat"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* COACH TOOLKIT QUICK ACCESS */}
      <div className="grid grid-cols-4 gap-2 shrink-0">
        {[
          {
            key: 'review',
            icon: <ClipboardCheck className="w-4 h-4" />,
            short: 'Review',
            title: 'Adaptive training review',
            sub: 'Evidence-based plan tweaks',
            onClick: () => setIsAdaptiveReviewOpen(true)
          },
          {
            key: 'warmup',
            icon: <Flame className="w-4 h-4" />,
            short: 'Warm-up',
            title: '5-min dynamic warm-up',
            sub: 'RAMP pre-workout routine',
            onClick: () => setIsWarmupModalOpen(true)
          },
          {
            key: 'dream',
            icon: <Sparkles className="w-4 h-4" />,
            short: 'Physique',
            title: 'Dream physique & blueprint',
            sub: 'AI photo + diet & split plan',
            onClick: () => setIsDreamPhysiqueModalOpen(true)
          },
          {
            key: 'posture',
            icon: <ShieldCheck className="w-4 h-4" />,
            short: 'Form cues',
            title: 'Posture & form cues',
            sub: 'Interactive joint visualizer',
            onClick: () => setPostureModalExercise('Barbell Back Squat')
          }
        ].map((t) => (
          <button
            type="button"
            key={t.key}
            onClick={t.onClick}
            className="touch-press group text-left min-h-[52px] p-2.5 sm:p-3 rounded-xl bg-surface border border-line hover:border-accent/40 hover:bg-surface-2 transition-colors flex flex-col sm:flex-row items-center sm:items-center justify-center sm:justify-between gap-1.5 sm:gap-2.5"
          >
            <span className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-surface-2 border border-line text-zinc-300 group-hover:text-accent flex items-center justify-center shrink-0 transition-colors" aria-hidden>
                {t.icon}
              </span>
              <span className="min-w-0 text-center sm:text-left">
                <span className="sm:hidden block text-[11px] font-medium text-zinc-200">{t.short}</span>
                <span className="hidden sm:block text-sm font-semibold text-white truncate">{t.title}</span>
                <span className="hidden sm:block text-xs text-zinc-400 truncate">{t.sub}</span>
              </span>
            </span>
            <ChevronRight className="hidden sm:block w-4 h-4 text-zinc-500 group-hover:text-accent transition-colors shrink-0" aria-hidden />
          </button>
        ))}
      </div>

      {/* CHAT MESSAGES SCROLL AREA */}
      <div className="flex-1 reshape-card p-4 sm:p-5 overflow-y-auto space-y-4">
        {messages.map((msg) => {
          const isAi = msg.role === 'model';
          return (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${isAi ? '' : 'flex-row-reverse'}`}
            >
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold font-mono ${
                  isAi
                    ? 'bg-accent/15 border border-accent/30 text-accent'
                    : 'bg-surface-2 border border-line text-white'
                }`}
              >
                {isAi ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 space-y-2 text-sm leading-relaxed ${
                  isAi
                    ? 'bg-canvas/90 border border-line text-zinc-200 shadow-md'
                    : 'bg-accent text-accent-ink font-medium font-sans shadow-md'
                }`}
              >
                <div className="whitespace-pre-line">{msg.text}</div>

                {/* Direct Action Button attached to AI message */}
                {msg.suggestedAction && isAi && (
                  <div className="pt-2 border-t border-line">
                    <button
                      onClick={() => handleActionClick(msg.suggestedAction)}
                      className="touch-press px-3.5 py-1.5 bg-accent/15 hover:bg-accent/25 border border-accent/40 text-accent font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-accent" />
                      <span>{msg.suggestedAction.label}</span>
                      <ChevronRight className="w-3 h-3 text-accent" />
                    </button>
                  </div>
                )}

                <div
                  className={`text-[11px] font-mono flex items-center justify-end ${
                    isAi ? 'text-zinc-500' : 'text-accent-ink/70 font-semibold'
                  }`}
                >
                  {msg.timestamp}
                </div>
              </div>
            </div>
          );
        })}

        {isSending && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
              <Bot className="w-4 h-4 animate-pulse" />
            </div>
            <div className="p-3 bg-canvas border border-line rounded-2xl text-xs text-zinc-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
              <span>Coach Iron is analyzing biomechanics and training data...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* QUICK COACH PROMPTS */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none shrink-0">
        {[
          'Start 5-min pre-workout warm-up',
          'Visualize dream physique & diet blueprint',
          'Preview squat posture & knee angles',
          'Check bench press elbow tuck cues',
          'How to fix deadlift lower back rounding?',
          'Optimal rest time for double progression?',
          'Pair Bluetooth fitness monitor'
        ].map((chip) => (
          <button
            key={chip}
            onClick={() => handleSendMessage(chip)}
            className="px-3.5 py-1.5 bg-canvas hover:bg-surface-2 border border-line text-zinc-300 hover:text-white rounded-xl text-xs whitespace-nowrap transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* INPUT BAR */}
      <div className="bg-surface border border-line rounded-2xl p-2.5 flex items-center gap-2 shrink-0 shadow-lg">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          placeholder="Ask Coach Iron anything: form cues, posture checkpoints, rest intervals..."
          className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none"
        />

        <button
          onClick={() => handleSendMessage()}
          disabled={!inputText.trim() || isSending}
          className="touch-press px-4 py-2 bg-accent hover:bg-accent disabled:opacity-40 text-accent-ink font-nrc font-bold text-xs sm:text-sm rounded-xl shadow-md flex items-center gap-1.5 transition-colors shrink-0"
        >
          <span>Send</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* POSTURE PREVIEW MODAL */}
      {postureModalExercise && (
        <ExercisePostureModal
          exerciseName={postureModalExercise}
          isOpen={Boolean(postureModalExercise)}
          onClose={() => setPostureModalExercise(null)}
          profile={profile}
        />
      )}

      {/* DYNAMIC 5-MINUTE PRE-WORKOUT WARM-UP MODAL */}
      <DynamicWarmupModal
        isOpen={isWarmupModalOpen}
        onClose={() => setIsWarmupModalOpen(false)}
        muscleGroups={
          activeSession
            ? Array.from(new Set(activeSession.exercises.map((e) => e.muscleGroup).filter(Boolean)))
            : ['Chest', 'Shoulders', 'Triceps']
        }
        exercises={
          activeSession
            ? activeSession.exercises.map((e) => e.name)
            : ['Barbell Bench Press', 'Incline Dumbbell Press']
        }
        workoutName={activeSession ? activeSession.dayName : 'Upper Hypertrophy'}
      />

      {/* AI DREAM PHYSIQUE VISUALIZER MODAL */}
      <AdaptiveReviewModal
        open={isAdaptiveReviewOpen}
        onClose={() => setIsAdaptiveReviewOpen(false)}
        profile={profile}
        activeSession={activeSession}
      />

      <DreamPhysiqueModal
        isOpen={isDreamPhysiqueModalOpen}
        onClose={() => setIsDreamPhysiqueModalOpen(false)}
        profile={profile}
        onProfileUpdated={onProfileUpdated}
        onPlanCreated={() => {
          onNavigate('plans');
        }}
      />
    </div>
  );
};
