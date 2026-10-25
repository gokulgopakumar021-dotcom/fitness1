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
    <div className="flex flex-col h-[calc(100vh-130px)] max-w-5xl mx-auto space-y-4">
      {/* Top Trainer Header Bar */}
      <div className="reshape-card p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#CEFF00]/15 border border-[#CEFF00]/30 flex items-center justify-center text-[#CEFF00] font-nrc font-black text-xl italic shadow-md">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-nrc font-black italic uppercase text-white text-lg sm:text-xl tracking-tight">
                Coach Iron · AI Fitness Trainer
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-lg bg-[#CEFF00]/15 border border-[#CEFF00]/30 text-[#CEFF00] font-bold uppercase not-italic">
                Active Coach
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 font-sans">
              Real-time form cues, 5-min warm-ups, dream physique blueprints, and live gadget telemetry
            </p>
          </div>
        </div>

        {/* Telemetry & Audio Toggle */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          {isConnected && device && (
            <div
              onClick={() => setIsGadgetModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500/10 border border-sky-500/30 text-sky-300 rounded-xl cursor-pointer hover:bg-sky-500/20 transition-colors"
            >
              <Bluetooth className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
              <span>{liveHeartRate ? `${liveHeartRate} BPM` : 'Connected'}</span>
            </div>
          )}

          {activeSession && (
            <div
              onClick={() => onNavigate('workouts')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#CEFF00]/10 border border-[#CEFF00]/30 text-[#CEFF00] rounded-xl cursor-pointer hover:bg-[#CEFF00]/20 transition-colors"
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
            className={`p-2 rounded-xl border transition-colors ${
              isSpeechEnabled
                ? 'bg-[#CEFF00] text-black border-[#CEFF00] font-bold shadow-md'
                : 'bg-zinc-950 border-white/[0.08] text-zinc-400 hover:text-white'
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
            className="p-2 bg-zinc-950 hover:bg-zinc-900 border border-white/[0.08] text-zinc-400 hover:text-white rounded-xl transition-colors"
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
          className="touch-press text-left p-3.5 rounded-2xl bg-zinc-950/80 border border-white/[0.06] hover:border-amber-400/50 transition-all flex items-center justify-between group shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-400/20 text-amber-400 flex items-center justify-center shrink-0">
              <Flame className="w-4 h-4 fill-amber-400" />
            </div>
            <div>
              <span className="font-bold text-xs text-white block group-hover:text-amber-300 transition-colors">
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
          className="touch-press text-left p-3.5 rounded-2xl bg-zinc-950/80 border border-white/[0.06] hover:border-[#CEFF00]/50 transition-all flex items-center justify-between group shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#CEFF00]/20 text-[#CEFF00] flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-xs text-white block group-hover:text-[#CEFF00] transition-colors">
                Dream Physique &amp; Blueprint
              </span>
              <span className="text-[11px] text-zinc-400 block truncate max-w-[160px]">
                AI photo + diet &amp; split plan
              </span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-[#CEFF00] transition-colors" />
        </button>

        <button
          onClick={() => setPostureModalExercise('Barbell Back Squat')}
          className="touch-press text-left p-3.5 rounded-2xl bg-zinc-950/80 border border-white/[0.06] hover:border-sky-400/50 transition-all flex items-center justify-between group shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-400/20 text-sky-400 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-xs text-white block group-hover:text-sky-300 transition-colors">
                Posture &amp; Form Cues
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
                    ? 'bg-[#CEFF00]/15 border border-[#CEFF00]/30 text-[#CEFF00]'
                    : 'bg-zinc-900 border border-white/[0.1] text-white'
                }`}
              >
                {isAi ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-3xl p-4 space-y-2 text-xs sm:text-sm leading-relaxed ${
                  isAi
                    ? 'bg-zinc-950/90 border border-white/[0.06] text-zinc-200 shadow-md'
                    : 'bg-[#CEFF00] text-black font-medium font-sans shadow-md'
                }`}
              >
                <div className="whitespace-pre-line">{msg.text}</div>

                {/* Direct Action Button attached to AI message */}
                {msg.suggestedAction && isAi && (
                  <div className="pt-2 border-t border-white/[0.06]">
                    <button
                      onClick={() => handleActionClick(msg.suggestedAction)}
                      className="touch-press px-3.5 py-1.5 bg-[#CEFF00]/15 hover:bg-[#CEFF00]/25 border border-[#CEFF00]/40 text-[#CEFF00] font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#CEFF00]" />
                      <span>{msg.suggestedAction.label}</span>
                      <ChevronRight className="w-3 h-3 text-[#CEFF00]" />
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
            <div className="w-8 h-8 rounded-xl bg-[#CEFF00]/15 border border-[#CEFF00]/30 flex items-center justify-center text-[#CEFF00] shrink-0">
              <Bot className="w-4 h-4 animate-pulse" />
            </div>
            <div className="p-3 bg-zinc-950 border border-white/[0.06] rounded-2xl text-xs text-zinc-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#CEFF00] animate-ping" />
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
            className="px-3.5 py-1.5 bg-zinc-950 hover:bg-zinc-900 border border-white/[0.08] text-zinc-300 hover:text-white rounded-xl text-xs whitespace-nowrap transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* INPUT BAR */}
      <div className="bg-[#090c12] border border-white/[0.08] rounded-2xl p-2.5 flex items-center gap-2 shrink-0 shadow-lg">
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
          className="touch-press px-4 py-2 bg-[#CEFF00] hover:bg-[#d4ff00] disabled:opacity-40 text-black font-nrc font-black italic uppercase text-xs sm:text-sm rounded-xl shadow-md flex items-center gap-1.5 transition-colors shrink-0"
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
