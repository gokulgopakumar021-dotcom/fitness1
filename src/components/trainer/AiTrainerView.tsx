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
  ChevronRight
} from 'lucide-react';
import { UserProfile, WorkoutSession } from '../../types';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { ExercisePostureModal } from '../posture/ExercisePostureModal';
import { DynamicWarmupModal } from './DynamicWarmupModal';
import { DreamPhysiqueModal } from './DreamPhysiqueModal';
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

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const speakText = (text: string) => {
    if (!isSpeechEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      // Remove markdown chars for clean voice output
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
          bluetooth: {
            isConnected,
            deviceName: device?.name,
            bpm: liveHeartRate
          }
        })
      });

      const data = await response.json();
      const replyText = data.reply || "Focus on bracing your core and driving through the floor with full intent!";

      // Detect if user asked about specific features or foundational lifts
      let suggestedAction: ChatMessage['suggestedAction'];
      const lower = text.toLowerCase() + ' ' + replyText.toLowerCase();
      if (lower.includes('warmup') || lower.includes('warm-up') || lower.includes('ramp') || lower.includes('prime') || lower.includes('priming')) {
        suggestedAction = { type: 'dynamic_warmup', label: 'Launch 5-Min Dynamic Warm-up' };
      } else if (lower.includes('physique') || lower.includes('dream body') || lower.includes('photo') || lower.includes('transformation') || lower.includes('target body') || lower.includes('diet plan')) {
        suggestedAction = { type: 'dream_physique', label: 'Visualize Dream Body & Get Blueprint' };
      } else if (lower.includes('squat')) {
        suggestedAction = { type: 'preview_posture', payload: 'Barbell Back Squat', label: 'Preview Squat Posture Model' };
      } else if (lower.includes('bench')) {
        suggestedAction = { type: 'preview_posture', payload: 'Barbell Bench Press', label: 'Preview Bench Press Posture' };
      } else if (lower.includes('deadlift') || lower.includes('rdl')) {
        suggestedAction = { type: 'preview_posture', payload: 'Conventional Barbell Deadlift', label: 'Preview Deadlift Posture' };
      } else if (lower.includes('press') || lower.includes('overhead')) {
        suggestedAction = { type: 'preview_posture', payload: 'Standing Overhead Barbell Press', label: 'Preview Overhead Press Posture' };
      } else if (lower.includes('heart') || lower.includes('bluetooth') || lower.includes('gadget') || lower.includes('pulse')) {
        suggestedAction = { type: 'open_bluetooth', label: 'Open Bluetooth Gadgets Hub' };
      }

      const modelMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'model',
        text: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedAction
      };

      setMessages((prev) => [...prev, modelMsg]);
      speakText(replyText);
    } catch {
      const fallbackMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'model',
        text: "I'm with you on the gym floor! Remember to keep your spine neutral, maintain tripod foot pressure on leg drives, and rest 2-3 minutes between heavy working sets.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setIsSending(false);
    }
  };

  const handleActionClick = (action: ChatMessage['suggestedAction']) => {
    if (!action) return;
    if (action.type === 'preview_posture') {
      setPostureModalExercise(action.payload || 'Barbell Back Squat');
    } else if (action.type === 'open_bluetooth') {
      setIsGadgetModalOpen(true);
    } else if (action.type === 'dynamic_warmup') {
      setIsWarmupModalOpen(true);
    } else if (action.type === 'dream_physique') {
      setIsDreamPhysiqueModalOpen(true);
    } else if (action.type === 'navigate_workouts') {
      onNavigate('workouts');
    } else if (action.type === 'navigate_progression') {
      onNavigate('progression');
    }
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
      {/* TRAINER HEADER */}
      <div className="bg-[#0b0f14] border border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-xl shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-lime-400/10 border border-lime-400/30 flex items-center justify-center text-lime-400 font-extrabold text-lg">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-extrabold text-zinc-100 text-base sm:text-lg tracking-tight">
                Coach Iron &middot; AI Fitness Trainer
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-lime-400/15 border border-lime-400/30 text-lime-400 font-bold uppercase">
                Active Biomechanics Coach
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Real-time form cues, 5-min warm-ups, dream physique blueprints, and live gadget telemetry
            </p>
          </div>
        </div>

        {/* Telemetry Pills & Audio Toggle */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          {isConnected && device && (
            <div
              onClick={() => setIsGadgetModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-sky-500/10 border border-sky-500/30 text-sky-300 rounded-lg cursor-pointer hover:bg-sky-500/20 transition-colors"
            >
              <Bluetooth className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
              <span>{liveHeartRate ? `${liveHeartRate} BPM` : 'Connected'}</span>
            </div>
          )}

          {activeSession && (
            <div
              onClick={() => onNavigate('workouts')}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-lime-500/10 border border-lime-500/30 text-lime-300 rounded-lg cursor-pointer hover:bg-lime-500/20 transition-colors"
            >
              <Dumbbell className="w-3.5 h-3.5" />
              <span className="truncate max-w-[120px]">{activeSession.dayName}</span>
            </div>
          )}

          <button
            onClick={() => {
              const next = !isSpeechEnabled;
              setIsSpeechEnabled(next);
              if (!next && typeof window !== 'undefined' && window.speechSynthesis) {
                window.speechSynthesis.cancel();
              }
            }}
            className={`p-2 rounded-lg border transition-colors ${
              isSpeechEnabled
                ? 'bg-lime-400 text-black border-lime-400 font-bold'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
            title={isSpeechEnabled ? 'Mute AI voice output' : 'Enable voice read-out for hands-free training'}
          >
            {isSpeechEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <button
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
            className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors"
            title="Reset Chat"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* COACH TOOLKIT QUICK ACCESS BANNER */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 shrink-0">
        <button
          onClick={() => setIsWarmupModalOpen(true)}
          className="touch-press text-left p-3 rounded-2xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 hover:border-amber-400 transition-all flex items-center justify-between group shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-400/20 text-amber-400 flex items-center justify-center shrink-0">
              <Flame className="w-4 h-4 fill-amber-400" />
            </div>
            <div>
              <span className="font-extrabold text-xs text-zinc-100 block group-hover:text-amber-400 transition-colors">
                5-Min Dynamic Warm-up
              </span>
              <span className="text-[11px] text-zinc-400 block truncate max-w-[160px]">
                RAMP pre-workout routine
              </span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-amber-400 transition-colors" />
        </button>

        <button
          onClick={() => setIsDreamPhysiqueModalOpen(true)}
          className="touch-press text-left p-3 rounded-2xl bg-gradient-to-r from-lime-500/10 to-emerald-500/10 border border-lime-400/40 hover:border-lime-400 transition-all flex items-center justify-between group shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-lime-400/20 text-lime-400 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <span className="font-extrabold text-xs text-zinc-100 block group-hover:text-lime-400 transition-colors">
                Dream Physique & Blueprint
              </span>
              <span className="text-[11px] text-zinc-400 block truncate max-w-[160px]">
                AI photo + diet & split plan
              </span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-lime-400 transition-colors" />
        </button>

        <button
          onClick={() => setPostureModalExercise('Barbell Back Squat')}
          className="touch-press text-left p-3 rounded-2xl bg-gradient-to-r from-sky-500/10 to-indigo-500/10 border border-sky-500/30 hover:border-sky-400 transition-all flex items-center justify-between group shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-400/20 text-sky-400 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <span className="font-extrabold text-xs text-zinc-100 block group-hover:text-sky-400 transition-colors">
                Posture & Form Cues
              </span>
              <span className="text-[11px] text-zinc-400 block truncate max-w-[160px]">
                Interactive joint visualizer
              </span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-sky-400 transition-colors" />
        </button>
      </div>

      {/* CHAT MESSAGES SCROLL AREA */}
      <div className="flex-1 bg-[#090b0e] border border-zinc-800 rounded-2xl p-4 overflow-y-auto space-y-4 shadow-inner">
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
                    ? 'bg-lime-400/15 border border-lime-400/30 text-lime-400'
                    : 'bg-zinc-800 border border-zinc-700 text-zinc-200'
                }`}
              >
                {isAi ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-3.5 space-y-2 text-xs sm:text-sm leading-relaxed ${
                  isAi
                    ? 'bg-zinc-900/90 border border-zinc-800 text-zinc-200 shadow-md'
                    : 'bg-lime-400 text-black font-medium font-sans shadow-md'
                }`}
              >
                <div className="whitespace-pre-line">{msg.text}</div>

                {/* Direct Action Button attached to AI message */}
                {msg.suggestedAction && isAi && (
                  <div className="pt-2 border-t border-zinc-800">
                    <button
                      onClick={() => handleActionClick(msg.suggestedAction)}
                      className="touch-press px-3 py-1.5 bg-lime-400/15 hover:bg-lime-400/25 border border-lime-400/40 text-lime-300 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-lime-400" />
                      <span>{msg.suggestedAction.label}</span>
                      <ChevronRight className="w-3 h-3 text-lime-400" />
                    </button>
                  </div>
                )}

                <div
                  className={`text-[10px] font-mono flex items-center justify-end ${
                    isAi ? 'text-zinc-500' : 'text-black/60 font-semibold'
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
            <div className="w-8 h-8 rounded-xl bg-lime-400/15 border border-lime-400/30 flex items-center justify-center text-lime-400 shrink-0">
              <Bot className="w-4 h-4 animate-pulse" />
            </div>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-2xl text-xs text-zinc-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-lime-400 animate-ping" />
              <span>Coach Iron is analyzing biomechanics and training data...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* QUICK COACH PROMPTS CHIPS */}
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
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-xl text-xs whitespace-nowrap transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* INPUT BAR */}
      <div className="bg-[#0b0f14] border border-zinc-800 rounded-2xl p-2.5 flex items-center gap-2 shrink-0 shadow-lg">
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
          className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        />

        <button
          onClick={() => handleSendMessage()}
          disabled={!inputText.trim() || isSending}
          className="touch-press px-4 py-2.5 bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-black font-extrabold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-colors shrink-0"
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

      {/* AI DREAM PHYSIQUE VISUALIZER & TRANSFORMATION BLUEPRINT MODAL */}
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
