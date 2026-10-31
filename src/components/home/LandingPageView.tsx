import React, { useState } from 'react';
import {
  Dumbbell,
  TrendingUp,
  Apple,
  Activity,
  Bot,
  FileSpreadsheet,
  History,
  ShieldCheck,
  ArrowRight,
  Zap,
  CheckCircle2,
  Lock,
  ChevronRight,
  Flame,
  Award,
  BarChart3,
  Scale,
  Sparkles,
  Layers,
  Database,
  Smartphone,
  Check
} from 'lucide-react';
import { Button } from '../ui/Button';
import { BrandLogo, BrandEmblem } from '../ui/BrandLogo';
import { BRAND } from '../../brand';

export interface LandingPageProps {
  onGoToSignIn?: () => void;
  onGoToSignUp?: () => void;
  onSignIn?: () => void;
  onSignUp?: () => void;
}

export type LandingPageViewProps = LandingPageProps;

export const LandingPageView: React.FC<LandingPageProps> = ({
  onGoToSignIn,
  onGoToSignUp,
  onSignIn,
  onSignUp
}) => {
  const handleSignIn = onSignIn || onGoToSignIn || (() => {});
  const handleSignUp = onSignUp || onGoToSignUp || (() => {});
  const [activeEngineTab, setActiveEngineTab] = useState<'overload' | 'tracker' | 'nutrition' | 'timeline'>('overload');

  return (
    <div className="min-h-dvh bg-[var(--bg-canvas)] text-[var(--text-primary)] font-sans flex flex-col selection:bg-accent selection:text-zinc-950">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 w-full border-b border-line bg-surface/90 backdrop-blur-md px-4 sm:px-8 py-3.5 flex items-center justify-between transition-colors">
        <div className="flex items-center gap-3">
          <BrandEmblem className="h-8 sm:h-9" />
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-mono font-black tracking-widest text-base text-zinc-100">
                IRONLOG AI
              </span>
            </div>
            <span className="text-[10px] text-zinc-400 font-mono tracking-wider hidden sm:block">
              {BRAND.tagline}
            </span>
          </div>
        </div>

        {/* Desktop Quick Nav Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-mono text-zinc-400">
          <a href="#engines" className="hover:text-accent transition-colors">FEATURES</a>
          <a href="#interactive-preview" className="hover:text-accent transition-colors">PREVIEW</a>
          <a href="#security" className="hover:text-accent transition-colors">PRIVACY</a>
          <a href="#faq" className="hover:text-accent transition-colors">FAQ</a>
        </nav>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleSignIn}
            className="px-3.5 py-2 text-xs font-mono font-bold text-zinc-300 hover:text-accent transition-colors rounded-xl border border-line hover:border-accent/40 bg-surface-2/60"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={handleSignUp}
            className="px-4 py-2 text-xs font-mono font-bold text-zinc-950 bg-accent hover:brightness-110 active:scale-95 transition-all rounded-xl shadow-[0_0_20px_rgba(139,249,9,0.25)] flex items-center gap-1.5"
          >
            <span>Create account</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 py-8 sm:py-16 flex flex-col gap-16 sm:gap-24">
        {/* Hero Section */}
        <section className="flex flex-col items-center text-center pt-4 sm:pt-10">
          <BrandLogo variant="full" eager className="h-40 sm:h-52 mb-4" />
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent/40 bg-accent/10 text-accent text-xs font-mono mb-6">
            <Zap className="w-3.5 h-3.5" />
            <span>AI-POWERED FITNESS &amp; PERSONAL TRAINING</span>
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black tracking-tight text-zinc-100 max-w-4xl leading-[1.1] uppercase">
            Train Smarter. <br className="hidden sm:inline" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent via-lime-300 to-emerald-400">
              Build Stronger.
            </span>
          </h1>

          <p className="mt-6 text-sm sm:text-base md:text-lg text-zinc-400 max-w-2xl leading-relaxed">
            Your AI personal trainer, strength tracker, nutrition coach and recovery guide, with real-time Workout Mirror form feedback and Body Scan, all in one private platform.
          </p>

          {/* Primary Call to Actions */}
          <div className="mt-8 flex flex-col sm:flex-row items-center gap-3.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleSignUp}
              className="w-full sm:w-auto px-7 py-3.5 text-sm font-mono font-bold text-zinc-950 bg-accent hover:brightness-110 active:scale-95 transition-all rounded-xl shadow-[0_0_30px_rgba(139,249,9,0.3)] flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-zinc-950" />
              <span>Get Started — Free</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleSignIn}
              className="w-full sm:w-auto px-6 py-3.5 text-sm font-mono font-bold text-zinc-200 bg-surface border border-line hover:border-zinc-500 hover:text-accent transition-all rounded-xl flex items-center justify-center gap-2"
            >
              <span>Already a member? Sign in</span>
              <ChevronRight className="w-4 h-4 text-zinc-500" />
            </button>
          </div>

          {/* System Spec Badges */}
          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-3xl pt-6 border-t border-line/60">
            <div className="p-3 bg-surface/60 border border-line rounded-xl text-left">
              <span className="text-[10px] font-mono text-zinc-500 block uppercase">DATA</span>
              <span className="text-xs font-mono font-bold text-zinc-200 flex items-center gap-1.5 mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-accent" /> Local-First Storage
              </span>
            </div>
            <div className="p-3 bg-surface/60 border border-line rounded-xl text-left">
              <span className="text-[10px] font-mono text-zinc-500 block uppercase">TRAINING</span>
              <span className="text-xs font-mono font-bold text-zinc-200 flex items-center gap-1.5 mt-0.5">
                <TrendingUp className="w-3.5 h-3.5 text-accent" /> Smart Progression
              </span>
            </div>
            <div className="p-3 bg-surface/60 border border-line rounded-xl text-left">
              <span className="text-[10px] font-mono text-zinc-500 block uppercase">NUTRITION</span>
              <span className="text-xs font-mono font-bold text-zinc-200 flex items-center gap-1.5 mt-0.5">
                <Apple className="w-3.5 h-3.5 text-accent" /> Adaptive Targets
              </span>
            </div>
            <div className="p-3 bg-surface/60 border border-line rounded-xl text-left">
              <span className="text-[10px] font-mono text-zinc-500 block uppercase">PRIVACY</span>
              <span className="text-xs font-mono font-bold text-zinc-200 flex items-center gap-1.5 mt-0.5">
                <Lock className="w-3.5 h-3.5 text-accent" /> Private by Design
              </span>
            </div>
          </div>
        </section>

        {/* Interactive Feature Preview Bento */}
        <section id="interactive-preview" className="scroll-mt-20">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 gap-4">
            <div>
              <span className="text-xs font-mono text-accent uppercase tracking-wider block">PRODUCT PREVIEW</span>
              <h2 className="text-2xl sm:text-3xl font-black text-zinc-100 tracking-tight mt-1">
                BUILT FOR SERIOUS TRAINING
              </h2>
            </div>
            {/* Tab Pills */}
            <div className="flex flex-wrap gap-2 p-1 bg-surface-2 border border-line rounded-xl">
              {[
                { id: 'overload', label: 'Overload Engine', icon: TrendingUp },
                { id: 'tracker', label: 'Live Tracker', icon: Dumbbell },
                { id: 'nutrition', label: 'TDEE & Fuel', icon: Apple },
                { id: 'timeline', label: 'Progress Timeline', icon: History }
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeEngineTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveEngineTab(tab.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${
                      isActive
                        ? 'bg-accent text-zinc-950 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Interactive Screen Preview Box */}
          <div className="bg-surface border border-line rounded-2xl p-5 sm:p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

            {activeEngineTab === 'overload' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-line pb-4">
                  <div>
                    <span className="text-[10px] font-mono text-accent uppercase tracking-wider">AUTOMATED ALGORITHM</span>
                    <h3 className="text-lg font-bold text-zinc-100">Progressive Overload Calculation</h3>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-accent/20 border border-accent/40 text-accent font-mono text-xs font-bold">
                    +2.5 KG READY
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-surface-2 border border-line rounded-xl">
                    <span className="text-xs font-mono text-zinc-400">Exercise</span>
                    <p className="text-base font-bold text-zinc-100 mt-1">Barbell Back Squat</p>
                    <span className="text-xs text-accent font-mono mt-2 block">Target: 3 × 8 @ 100 kg</span>
                  </div>
                  <div className="p-4 bg-surface-2 border border-line rounded-xl">
                    <span className="text-xs font-mono text-zinc-400">Last Session Outcome</span>
                    <p className="text-base font-bold text-zinc-100 mt-1">8 / 8 / 8 reps (Target Hit)</p>
                    <span className="text-xs text-success font-mono mt-2 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Ceiling Reps Achieved
                    </span>
                  </div>
                  <div className="p-4 bg-accent/10 border border-accent/40 rounded-xl">
                    <span className="text-xs font-mono text-accent font-bold">Recommended Load Next Session</span>
                    <p className="text-2xl font-black text-zinc-100 mt-1">102.5 kg</p>
                    <span className="text-xs text-zinc-300 font-mono mt-2 block">+2.5 kg micro-load progression</span>
                  </div>
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed font-mono">
                  IronLog AI evaluates rep targets, RPE / RIR readings, and set failure thresholds across your last 3 workouts. When ceiling volume is sustained, it signals the exact micro-load bump required.
                </p>
              </div>
            )}

            {activeEngineTab === 'tracker' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-line pb-4">
                  <div>
                    <span className="text-[10px] font-mono text-accent uppercase tracking-wider">IN-SESSION INTERFACE</span>
                    <h3 className="text-lg font-bold text-zinc-100">Live Set Logger & Plate Math</h3>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-surface-2 border border-line text-zinc-300 font-mono text-xs">
                    REST: 01:45
                  </span>
                </div>

                <div className="space-y-3 font-mono text-xs">
                  <div className="grid grid-cols-5 p-2.5 bg-surface-2/80 rounded-lg text-zinc-400 font-semibold">
                    <span>SET</span>
                    <span>PREVIOUS</span>
                    <span>WEIGHT (KG)</span>
                    <span>REPS</span>
                    <span className="text-right">RPE</span>
                  </div>
                  <div className="grid grid-cols-5 p-2.5 bg-surface-2 border border-line rounded-lg text-zinc-200 items-center">
                    <span className="text-accent font-bold">1</span>
                    <span className="text-zinc-500">80 kg × 10</span>
                    <span className="font-bold">82.5 kg</span>
                    <span className="font-bold">10 reps</span>
                    <span className="text-right text-emerald-400">7.5</span>
                  </div>
                  <div className="grid grid-cols-5 p-2.5 bg-surface-2 border border-line rounded-lg text-zinc-200 items-center">
                    <span className="text-accent font-bold">2</span>
                    <span className="text-zinc-500">80 kg × 9</span>
                    <span className="font-bold">82.5 kg</span>
                    <span className="font-bold">10 reps</span>
                    <span className="text-right text-emerald-400">8.0</span>
                  </div>
                  <div className="grid grid-cols-5 p-2.5 bg-accent/10 border border-accent/30 rounded-lg text-zinc-100 items-center">
                    <span className="text-accent font-bold">3</span>
                    <span className="text-zinc-500">80 kg × 8</span>
                    <span className="font-bold text-accent">82.5 kg</span>
                    <span className="font-bold text-accent">9 reps</span>
                    <span className="text-right text-accent font-bold">9.0</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between text-xs text-zinc-400 pt-2 border-t border-line">
                  <span>Barbell Plate Math: 20kg bar + 2×(20kg + 10kg + 1.25kg)</span>
                  <span className="text-accent font-mono font-bold">Session Volume: 2,410 kg</span>
                </div>
              </div>
            )}

            {activeEngineTab === 'nutrition' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-line pb-4">
                  <div>
                    <span className="text-[10px] font-mono text-accent uppercase tracking-wider">METABOLIC ADAPTATION</span>
                    <h3 className="text-lg font-bold text-zinc-100">Nutrition Goal Wizard & Consistency Tracker</h3>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-mono text-xs font-bold">
                    TDEE: 2,650 KCAL
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 bg-surface-2 border border-line rounded-xl">
                    <span className="text-[10px] font-mono text-zinc-400 uppercase">CALORIE DEFICIT (CUT)</span>
                    <p className="text-xl font-mono font-black text-zinc-100 mt-1">2,150 <span className="text-xs text-zinc-400 font-normal">kcal</span></p>
                    <div className="w-full bg-surface h-1.5 rounded-full mt-2 overflow-hidden">
                      <div className="bg-accent h-full w-[82%]" />
                    </div>
                  </div>
                  <div className="p-3.5 bg-surface-2 border border-line rounded-xl">
                    <span className="text-[10px] font-mono text-zinc-400 uppercase">PROTEIN (2.2G/KG)</span>
                    <p className="text-xl font-mono font-black text-zinc-100 mt-1">185 <span className="text-xs text-zinc-400 font-normal">g</span></p>
                    <div className="w-full bg-surface h-1.5 rounded-full mt-2 overflow-hidden">
                      <div className="bg-emerald-400 h-full w-[94%]" />
                    </div>
                  </div>
                  <div className="p-3.5 bg-surface-2 border border-line rounded-xl">
                    <span className="text-[10px] font-mono text-zinc-400 uppercase">MACRO VARIANCE</span>
                    <p className="text-xl font-mono font-black text-emerald-400 mt-1">94% <span className="text-xs text-zinc-400 font-normal">adherent</span></p>
                    <span className="text-[10px] text-zinc-400 font-mono mt-1 block">Within 10% target tolerance</span>
                  </div>
                  <div className="p-3.5 bg-surface-2 border border-line rounded-xl">
                    <span className="text-[10px] font-mono text-zinc-400 uppercase">DAILY HYDRATION</span>
                    <p className="text-xl font-mono font-black text-blue-400 mt-1">3,000 <span className="text-xs text-zinc-400 font-normal">ml</span></p>
                    <span className="text-[10px] text-blue-400 font-mono mt-1 block">Goal reached (100%)</span>
                  </div>
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed font-mono">
                  Calculates basal metabolic rate using Katch-McArdle body composition formula. Accounts for activity multiplier, training load, and user-specified caloric surplus or deficit.
                </p>
              </div>
            )}

            {activeEngineTab === 'timeline' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-line pb-4">
                  <div>
                    <span className="text-[10px] font-mono text-accent uppercase tracking-wider">LONG-TERM ANALYTICS</span>
                    <h3 className="text-lg font-bold text-zinc-100">Multi-Metric Historical Progression</h3>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-surface-2 border border-line text-zinc-300 font-mono text-xs">
                    6-MONTH WINDOW
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-surface-2 border border-line rounded-xl">
                    <span className="text-xs font-mono text-zinc-400">Body Weight Delta</span>
                    <p className="text-xl font-black text-zinc-100 mt-1">84.2 kg → 79.8 kg</p>
                    <span className="text-xs text-emerald-400 font-mono mt-1 block">-4.4 kg (-5.2%) Lean Cut</span>
                  </div>
                  <div className="p-4 bg-surface-2 border border-line rounded-xl">
                    <span className="text-xs font-mono text-zinc-400">Bench Press Estimated 1RM</span>
                    <p className="text-xl font-black text-accent mt-1">105 kg → 118 kg</p>
                    <span className="text-xs text-accent font-mono mt-1 block">+13 kg (+12.4%) Epley Model</span>
                  </div>
                  <div className="p-4 bg-surface-2 border border-line rounded-xl">
                    <span className="text-xs font-mono text-zinc-400">Workout Consistency</span>
                    <p className="text-xl font-black text-zinc-100 mt-1">74 / 78 Sessions</p>
                    <span className="text-xs text-zinc-300 font-mono mt-1 block">94.8% Planned Adherence</span>
                  </div>
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed font-mono">
                  Unlogged days are excluded. Missing values are never filled with fabricated zeros or synthetic predictions. Every trendline is strictly anchored in ground truth.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* The 8 Fitness OS Core Engines Directory */}
        <section id="engines" className="scroll-mt-20">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-mono text-accent uppercase tracking-wider block">THE PLATFORM</span>
            <h2 className="text-2xl sm:text-4xl font-black text-zinc-100 tracking-tight mt-1">
              EVERYTHING YOU NEED TO TRAIN SMARTER
            </h2>
            <p className="text-sm text-zinc-400 mt-3">
              Every module works together, from your first set to your long-term progress, and is built on data you actually recorded.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Engine 1 */}
            <div className="p-5 bg-surface border border-line hover:border-accent/40 transition-colors rounded-2xl flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 text-accent flex items-center justify-center mb-4">
                <TrendingUp className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">ENGINE 01</span>
              <h3 className="text-base font-bold text-zinc-100 mt-1">Overload Engine</h3>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed flex-1">
                Automated double progression engine calculating exact load increments (+1.25kg, +2.5kg) once rep ranges are cleared.
              </p>
              <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span>RPE / RIR Driven</span>
                <span className="text-accent font-bold">ACTIVE</span>
              </div>
            </div>

            {/* Engine 2 */}
            <div className="p-5 bg-surface border border-line hover:border-accent/40 transition-colors rounded-2xl flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 text-accent flex items-center justify-center mb-4">
                <Dumbbell className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">ENGINE 02</span>
              <h3 className="text-base font-bold text-zinc-100 mt-1">Workout Tracker</h3>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed flex-1">
                Set-by-set recording with automatic rest timers, barbell plate math, warmup sets, previous session comparison, and drop sets.
              </p>
              <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span>Bluetooth Gadgets</span>
                <span className="text-accent font-bold">ACTIVE</span>
              </div>
            </div>

            {/* Engine 3 */}
            <div className="p-5 bg-surface border border-line hover:border-accent/40 transition-colors rounded-2xl flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 text-accent flex items-center justify-center mb-4">
                <Apple className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">ENGINE 03</span>
              <h3 className="text-base font-bold text-zinc-100 mt-1">TDEE Goal Wizard</h3>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed flex-1">
                Interactive macro wizard for cut, maintain, or bulk phases with weekly TDEE adaptation, water tracker, and 10% tolerance gauge.
              </p>
              <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span>Katch-McArdle Formula</span>
                <span className="text-accent font-bold">ACTIVE</span>
              </div>
            </div>

            {/* Engine 4 */}
            <div className="p-5 bg-surface border border-line hover:border-accent/40 transition-colors rounded-2xl flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 text-accent flex items-center justify-center mb-4">
                <History className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">ENGINE 04</span>
              <h3 className="text-base font-bold text-zinc-100 mt-1">Progress Timeline</h3>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed flex-1">
                Long-term progress analytics over 7d, 30d, 90d, 6mo, and all-time ranges. Epley estimated 1RM calculations with verified data only.
              </p>
              <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span>Verified Data Only</span>
                <span className="text-accent font-bold">ACTIVE</span>
              </div>
            </div>

            {/* Engine 5 */}
            <div className="p-5 bg-surface border border-line hover:border-accent/40 transition-colors rounded-2xl flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 text-accent flex items-center justify-center mb-4">
                <Activity className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">ENGINE 05</span>
              <h3 className="text-base font-bold text-zinc-100 mt-1">Muscle Fatigue Map</h3>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed flex-1">
                18-muscle volumetric fatigue distribution model with Unified Daily Health Scorecard integrating sleep quality and training strain.
              </p>
              <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span>Biological Recovery</span>
                <span className="text-accent font-bold">ACTIVE</span>
              </div>
            </div>

            {/* Engine 6 */}
            <div className="p-5 bg-surface border border-line hover:border-accent/40 transition-colors rounded-2xl flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 text-accent flex items-center justify-center mb-4">
                <Bot className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">ENGINE 06</span>
              <h3 className="text-base font-bold text-zinc-100 mt-1">AI Athletic Trainer</h3>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed flex-1">
                Real-time exercise analysis, fatigue adaptation, form cues, and video guidance grounded in exercise physiology.
              </p>
              <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span>Grounded Guidance</span>
                <span className="text-accent font-bold">ACTIVE</span>
              </div>
            </div>

            {/* Engine 7 */}
            <div className="p-5 bg-surface border border-line hover:border-accent/40 transition-colors rounded-2xl flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 text-accent flex items-center justify-center mb-4">
                <Scale className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">ENGINE 07</span>
              <h3 className="text-base font-bold text-zinc-100 mt-1">Silhouette Scanner</h3>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed flex-1">
                Body metrics ledger and silhouette scanner tracking waist, chest, biceps, and body fat percentage trends.
              </p>
              <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span>Circumference Ledger</span>
                <span className="text-accent font-bold">ACTIVE</span>
              </div>
            </div>

            {/* Engine 8 */}
            <div className="p-5 bg-surface border border-line hover:border-accent/40 transition-colors rounded-2xl flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 text-accent flex items-center justify-center mb-4">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">ENGINE 08</span>
              <h3 className="text-base font-bold text-zinc-100 mt-1">Spreadsheet Importer</h3>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed flex-1">
                Drop your existing Google Sheets or Excel routines. Automatically parses splits, rep ranges, rest intervals, and exercise rosters.
              </p>
              <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                <span>PPL / 531 / Custom</span>
                <span className="text-accent font-bold">ACTIVE</span>
              </div>
            </div>
          </div>
        </section>

        {/* Security and Ground Truth Architecture */}
        <section id="security" className="p-6 sm:p-10 bg-surface border border-line rounded-2xl">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-1.5 text-xs font-mono text-accent mb-2">
                <Lock className="w-3.5 h-3.5" />
                <span>PRIVATE BY DESIGN</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-zinc-100">
                Your Training Data Belongs to You.
              </h3>
              <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                Your workouts, nutrition and body metrics are tied to your private account. We do not sell your data or run ad trackers, and we never fill your history with made-up numbers.
              </p>
              <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono text-zinc-300">
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-accent" />
                  <span>Row-Level Security (RLS) enforcement</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-accent" />
                  <span>Local-first storage on your device</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-accent" />
                  <span>Email-verified account sign-in</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-accent" />
                  <span>One-click JSON & CSV data export</span>
                </li>
              </ul>
            </div>

            <div className="flex flex-col gap-3 w-full md:w-auto">
              <button
                type="button"
                onClick={onGoToSignUp}
                className="w-full sm:w-auto px-6 py-3.5 text-xs font-mono font-bold text-zinc-950 bg-accent hover:brightness-110 active:scale-95 transition-all rounded-xl shadow-[0_0_20px_rgba(139,249,9,0.25)] flex items-center justify-center gap-2"
              >
                <span>Create Free Account</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onGoToSignIn}
                className="w-full sm:w-auto px-6 py-3 text-xs font-mono text-zinc-300 hover:text-accent transition-colors text-center border border-line rounded-xl"
              >
                Sign in to existing account
              </button>
            </div>
          </div>
        </section>

        {/* Technical Specs & FAQ */}
        <section id="faq" className="scroll-mt-20">
          <div className="text-center max-w-xl mx-auto mb-10">
            <span className="text-xs font-mono text-accent uppercase tracking-wider block">FAQ</span>
            <h2 className="text-2xl font-black text-zinc-100 tracking-tight mt-1">
              QUESTIONS, ANSWERED
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 bg-surface border border-line rounded-xl">
              <h4 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-accent" />
                How does IronLog AI calculate progressive overload?
              </h4>
              <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
                Rather than arbitrary weight bumps, the engine tracks your specified target rep range (e.g. 8–10 reps). Once all target sets clear the top of the range at valid RPE, it recommends a micro-load jump (+1.25kg to +2.5kg) on the next session.
              </p>
            </div>

            <div className="p-5 bg-surface border border-line rounded-xl">
              <h4 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-accent" />
                Can I import my own spreadsheets?
              </h4>
              <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
                Yes. The built-in Spreadsheet Importer accepts CSV and Excel files for Push/Pull/Legs, Upper/Lower, 5/3/1, or custom splits, converting them into active training templates.
              </p>
            </div>

            <div className="p-5 bg-surface border border-line rounded-xl">
              <h4 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-accent" />
                How does the TDEE Wizard calculate daily fuel targets?
              </h4>
              <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
                It uses the Katch-McArdle formula based on your weight and body fat percentage, combined with your weekly workout frequency and goal phase (cut, maintenance, or bulk).
              </p>
            </div>

            <div className="p-5 bg-surface border border-line rounded-xl">
              <h4 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-accent" />
                Does the timeline invent data for missed workouts?
              </h4>
              <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
                Never. Recorded data is the source of truth. Unlogged days are excluded from averages rather than converted to fake zeros, and missing baselines never generate false progress percentages.
              </p>
            </div>
          </div>
        </section>

        {/* Bottom Call to Action Banner */}
        <section className="p-8 sm:p-12 rounded-3xl bg-gradient-to-b from-surface-2 to-surface border border-line text-center relative overflow-hidden shadow-2xl">
          <div className="absolute inset-0 bg-accent/5 pointer-events-none" />
          <div className="relative z-10 max-w-2xl mx-auto flex flex-col items-center">
            <BrandEmblem className="h-14 mb-4" />
            <h2 className="text-2xl sm:text-4xl font-black text-zinc-100 tracking-tight">
              TRAIN SMARTER. BUILD STRONGER.
            </h2>
            <p className="text-sm text-zinc-400 mt-3 max-w-lg leading-relaxed">
              Start free and let IronLog AI guide your progression, nutrition and recovery.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleSignUp}
                className="w-full sm:w-auto px-8 py-3.5 text-sm font-mono font-bold text-zinc-950 bg-accent hover:brightness-110 active:scale-95 transition-all rounded-xl shadow-[0_0_30px_rgba(139,249,9,0.35)] flex items-center justify-center gap-2"
              >
                <span>Create Free Account</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleSignIn}
                className="w-full sm:w-auto px-7 py-3.5 text-sm font-mono font-bold text-zinc-200 bg-surface-2 border border-line hover:border-zinc-500 hover:text-accent transition-all rounded-xl"
              >
                Sign In
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-line py-8 px-4 sm:px-8 mt-12 bg-surface text-xs font-mono text-zinc-400">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <BrandEmblem className="h-5" />
            <span className="font-bold text-zinc-200">IRONLOG AI // TRAIN SMARTER. BUILD STRONGER.</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleSignIn}
              className="hover:text-accent transition-colors"
            >
              Sign In
            </button>
            <span className="text-zinc-700">•</span>
            <button
              type="button"
              onClick={handleSignUp}
              className="hover:text-accent transition-colors"
            >
              Create Account
            </button>
            <span className="text-zinc-700">•</span>
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
              ALL ENGINES OPERATIONAL
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export const LandingPage = LandingPageView;
export default LandingPageView;
