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
  Bluetooth,
  Flame,
  ChevronRight,
  ClipboardCheck,
  Loader2
} from 'lucide-react';
import { UserProfile, WorkoutSession } from '../../types';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { ExercisePostureModal } from '../posture/ExercisePostureModal';
import { DynamicWarmupModal } from './DynamicWarmupModal';
import { DreamPhysiqueModal } from './DreamPhysiqueModal';
import { AdaptiveReviewModal } from './AdaptiveReviewModal';
import { NavTab } from '../layout/Navbar';
import { Badge, Button, Card } from '../ui';
import { getFormInsights } from '../../services/workoutMirror/mirrorStorage';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  suggestedAction?: {
    type:
      | 'preview_posture'
      | 'open_bluetooth'
      | 'navigate_workouts'
      | 'navigate_progression'
      | 'navigate_mirror'
      | 'dynamic_warmup'
      | 'dream_physique';
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
  }, [messages, isSending]);

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
          bluetooth: { isConnected, bpm: liveHeartRate },
          mirrorInsights: getFormInsights()
        })
      });

      const data = await response.json();
      const aiReplyText = data.reply || 'Keep proper lifting cadence and drive through your heels!';

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
      const insights = getFormInsights();
      let fallbackText = "I'm temporarily offline from cloud servers, but remember: adhere to double progression, rest 2-3 minutes between compound sets, and hit your daily protein quotas!";
      let action: ChatMessage['suggestedAction'] | undefined = undefined;

      if (text.toLowerCase().includes('mirror') || text.toLowerCase().includes('form')) {
        if (insights.length > 0) {
          const top = insights[0];
          fallbackText = `Based on your Workout Mirror sessions: you completed ${top.totalReps} reps of ${top.exerciseName} with ${top.averageConsistency}% form consistency. ${
            top.topCorrection ? `Key focus: "${top.topCorrection}"` : 'Your movement mechanics were solid!'
          }`;
          action = { type: 'navigate_mirror', label: 'Launch Workout Mirror' };
        } else {
          fallbackText = "You haven't recorded any Workout Mirror sessions yet! Open the Workout Mirror to get real-time computer vision tracking and technique coaching.";
          action = { type: 'navigate_mirror', label: 'Open Workout Mirror' };
        }
      }

      const fallbackMsg: ChatMessage = {
        id: `ai-err-${Date.now()}`,
        role: 'model',
        text: fallbackText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedAction: action
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
      case 'navigate_mirror':
        onNavigate('mirror');
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
    <div className="flex flex-col h-[calc(100dvh-10.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-8.5rem)] min-h-[500px] max-w-5xl mx-auto space-y-3 sm:space-y-4">
      {/* TRAINER HEADER */}
      <Card pad="sm" className="shrink-0 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-control bg-accent/10 border border-accent/30 flex items-center justify-center text-volt-adaptive shrink-0">
            <Bot className="w-5 h-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight leading-tight">
                Coach Iron
              </h1>
              <Badge tone="accent">
                AI Coach
              </Badge>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 truncate">
              <span className="sm:hidden">Biomechanical form cues &amp; adaptive plans</span>
              <span className="hidden sm:inline">
                Biomechanical cues, dynamic warm-ups, physique blueprints &amp; live gadget metrics
              </span>
            </p>
          </div>
        </div>

        {/* Telemetry pills & controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-xs shrink-0">
          {isConnected && device && (
            <button
              type="button"
              onClick={() => setIsGadgetModalOpen(true)}
              className="flex items-center gap-1.5 h-9 px-2.5 bg-info/10 border border-info/30 text-info rounded-control hover:bg-info/20 transition-colors tabular-nums"
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
              className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 bg-accent/10 border border-accent/30 text-volt-adaptive rounded-control hover:bg-accent/20 transition-colors font-medium"
            >
              <Dumbbell className="w-3.5 h-3.5" aria-hidden />
              <span className="truncate max-w-[130px]">{activeSession.dayName}</span>
            </button>
          )}

          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => {
              const next = !isSpeechEnabled;
              setIsSpeechEnabled(next);
              if (!next && typeof window !== 'undefined' && window.speechSynthesis) {
                window.speechSynthesis.cancel();
              }
            }}
            aria-pressed={isSpeechEnabled}
            aria-label={isSpeechEnabled ? 'Mute AI voice output' : 'Enable voice read-out'}
            title={isSpeechEnabled ? 'Mute AI voice output' : 'Enable voice read-out for hands-free training'}
            className={isSpeechEnabled ? 'text-volt-adaptive bg-accent/10 border border-accent/30' : ''}
          >
            {isSpeechEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            iconOnly
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
            title="Reset chat"
            aria-label="Reset chat"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>
      </Card>

      {/* COACH TOOLKIT QUICK ACCESS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
        {[
          {
            key: 'review',
            icon: <ClipboardCheck className="w-4 h-4 text-cyan-400" />,
            short: 'Adaptive Review',
            title: 'Adaptive Review',
            sub: 'Evidence-based plan tweaks',
            onClick: () => setIsAdaptiveReviewOpen(true)
          },
          {
            key: 'warmup',
            icon: <Flame className="w-4 h-4 text-amber-400" />,
            short: '5-Min Warm-up',
            title: '5-Min Dynamic Warm-up',
            sub: 'RAMP pre-workout routine',
            onClick: () => setIsWarmupModalOpen(true)
          },
          {
            key: 'dream',
            icon: <Sparkles className="w-4 h-4 text-volt-adaptive" />,
            short: 'Physique Blueprint',
            title: 'Physique Blueprint',
            sub: 'AI photo + macro & split plan',
            onClick: () => setIsDreamPhysiqueModalOpen(true)
          },
          {
            key: 'posture',
            icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />,
            short: 'Form Cues',
            title: 'Posture & Form Cues',
            sub: 'Interactive joint visualizer',
            onClick: () => setPostureModalExercise('Barbell Back Squat')
          }
        ].map((t) => (
          <button
            type="button"
            key={t.key}
            onClick={t.onClick}
            className="group text-left min-h-[48px] p-2.5 sm:p-3 rounded-control bg-surface border border-line hover:border-line-strong hover:bg-surface-2 transition-colors flex items-center justify-between gap-2.5 shadow-sm"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-lg bg-surface-2 border border-line flex items-center justify-center shrink-0 group-hover:border-line-strong transition-colors"
                aria-hidden
              >
                {t.icon}
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-semibold text-white truncate">
                  <span className="sm:hidden">{t.short}</span>
                  <span className="hidden sm:inline">{t.title}</span>
                </span>
                <span className="hidden sm:block text-label text-zinc-400 truncate">
                  {t.sub}
                </span>
              </div>
            </div>
            <ChevronRight
              className="w-3.5 h-3.5 text-zinc-500 group-hover:text-white transition-colors shrink-0"
              aria-hidden
            />
          </button>
        ))}
      </div>

      {/* CHAT MESSAGES SCROLL AREA */}
      <Card
        pad="none"
        className="flex-1 p-3.5 sm:p-5 overflow-y-auto space-y-4 min-h-0 bg-surface/80"
      >
        {messages.map((msg) => {
          const isAi = msg.role === 'model';
          return (
            <div
              key={msg.id}
              className={`flex items-start gap-2.5 sm:gap-3 ${isAi ? '' : 'flex-row-reverse'}`}
            >
              <div
                className={`w-8 h-8 rounded-control flex items-center justify-center shrink-0 text-xs font-bold font-mono ${
                  isAi
                    ? 'bg-accent/15 border border-accent/30 text-volt-adaptive'
                    : 'bg-surface-2 border border-line text-white'
                }`}
              >
                {isAi ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[88%] sm:max-w-[78%] rounded-card p-3.5 sm:p-4 space-y-2 text-sm leading-relaxed ${
                  isAi
                    ? 'bg-surface-2 border border-line text-zinc-200 rounded-tl-sm shadow-sm'
                    : 'bg-accent text-accent-ink font-medium rounded-tr-sm shadow-sm'
                }`}
              >
                <div className="whitespace-pre-line text-xs sm:text-sm">{msg.text}</div>

                {/* Direct Action Button attached to AI message */}
                {msg.suggestedAction && isAi && (
                  <div className="pt-2 border-t border-line/60">
                    <button
                      type="button"
                      onClick={() => handleActionClick(msg.suggestedAction)}
                      className="px-3 py-1.5 bg-accent/15 hover:bg-accent/25 border border-accent/40 text-volt-adaptive font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-volt-adaptive" />
                      <span>{msg.suggestedAction.label}</span>
                      <ChevronRight className="w-3 h-3 text-volt-adaptive" />
                    </button>
                  </div>
                )}

                <div
                  className={`text-label font-mono flex items-center justify-end ${
                    isAi ? 'text-zinc-500' : 'text-accent-ink/75 font-semibold'
                  }`}
                >
                  {msg.timestamp}
                </div>
              </div>
            </div>
          );
        })}

        {isSending && (
          <div className="flex items-start gap-2.5 sm:gap-3">
            <div className="w-8 h-8 rounded-control bg-accent/15 border border-accent/30 flex items-center justify-center text-volt-adaptive shrink-0">
              <Bot className="w-4 h-4 animate-pulse" />
            </div>
            <div className="p-3 bg-surface-2 border border-line rounded-card rounded-tl-sm text-xs text-zinc-300 flex items-center gap-2.5 shadow-sm">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:0.3s]" />
              </span>
              <span>Coach Iron is analyzing biomechanics and training data...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </Card>

      {/* QUICK COACH PROMPTS */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none shrink-0">
        {[
          'Review my Workout Mirror technique',
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
            type="button"
            onClick={() => handleSendMessage(chip)}
            className="min-h-[36px] px-3 py-1.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-line-strong text-zinc-300 hover:text-white rounded-control text-xs whitespace-nowrap transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* INPUT BAR */}
      <div className="bg-surface border border-line rounded-control p-1.5 sm:p-2 flex items-center gap-2 shrink-0 shadow-sm focus-within:border-line-strong transition-colors">
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
          placeholder="Ask Coach Iron: form cues, posture checkpoints, rest intervals..."
          className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none"
        />

        <Button
          variant="primary"
          size="sm"
          disabled={!inputText.trim() || isSending}
          loading={isSending}
          icon={<Send className="w-3.5 h-3.5" />}
          onClick={() => handleSendMessage()}
        >
          Send
        </Button>
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

      {/* ADAPTIVE REVIEW MODAL */}
      <AdaptiveReviewModal
        open={isAdaptiveReviewOpen}
        onClose={() => setIsAdaptiveReviewOpen(false)}
        profile={profile}
        activeSession={activeSession}
      />

      {/* AI DREAM PHYSIQUE VISUALIZER MODAL */}
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
