import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  AlertTriangle,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Info,
  CheckCircle2,
  Activity,
  Flame,
  ArrowRight,
  Eye,
  Sliders
} from 'lucide-react';
import {
  ExerciseBiomechanicsData,
  getBiomechanicsForExercise
} from '../../data/exerciseBiomechanics';
import { UserProfile } from '../../types';

interface ExercisePostureModalProps {
  exerciseName: string;
  isOpen: boolean;
  onClose: () => void;
  profile?: UserProfile;
}

export const ExercisePostureModal: React.FC<ExercisePostureModalProps> = ({
  exerciseName,
  isOpen,
  onClose,
  profile
}) => {
  const [data, setData] = useState<ExerciseBiomechanicsData | null>(null);
  const [activeTab, setActiveTab] = useState<'visual' | 'checkpoints' | 'mistakes' | 'tempo' | 'ai_coach'>('visual');
  const [posturePhase, setPosturePhase] = useState<'setup' | 'bottom'>('setup');
  const [isPlayingAnimation, setIsPlayingAnimation] = useState<boolean>(true);
  const [animProgress, setAnimProgress] = useState<number>(0);

  // AI Cues State
  const [aiCustomQuestion, setAiCustomQuestion] = useState<string>('');
  const [aiCustomCues, setAiCustomCues] = useState<string | null>(null);
  const [isLoadingAiCues, setIsLoadingAiCues] = useState<boolean>(false);

  useEffect(() => {
    if (exerciseName) {
      setData(getBiomechanicsForExercise(exerciseName));
    }
  }, [exerciseName]);

  // Movement loop animation ticker
  useEffect(() => {
    if (!isPlayingAnimation) return;
    const interval = setInterval(() => {
      setAnimProgress((prev) => {
        const next = (prev + 0.05) % 2; // 0 -> 1 is descent, 1 -> 2 is ascent
        if (next < 1) {
          setPosturePhase('bottom');
        } else {
          setPosturePhase('setup');
        }
        return next;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isPlayingAnimation]);

  if (!isOpen || !data) return null;

  const handleAskAiCoach = async (promptQuery?: string) => {
    setIsLoadingAiCues(true);
    const query = promptQuery || aiCustomQuestion || `Provide elite biomechanical form cues for ${data.name} for an athlete with ${profile?.trainingExperience || 'intermediate'} experience.`;

    try {
      const response = await fetch('/api/ai-form-analyzer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseName: data.name,
          userQuestion: query,
          experience: profile?.trainingExperience || 'intermediate',
          goal: profile?.primaryGoal || 'Muscle Gain'
        })
      });

      const resData = await response.json();
      if (resData.success && resData.cues) {
        setAiCustomCues(resData.cues);
      } else {
        setAiCustomCues(resData.error || 'Coach is reviewing your form.');
      }
    } catch {
      setAiCustomCues(
        `Elite Biomechanical Cue for ${data.name}: Focus on maintaining a 360-degree intra-abdominal pressure brace before descending. Ground all 3 points of your feet into the floor, establish lat engagement to pack the humeral head, and lead with a controlled 3-second eccentric.`
      );
    } finally {
      setIsLoadingAiCues(false);
    }
  };

  // Render SVG Biomechanics Diagram based on diagramType
  const renderBiomechanicsCanvas = () => {
    const isBottom = posturePhase === 'bottom';

    return (
      <div className="relative bg-canvas border border-line rounded-2xl p-4 flex flex-col items-center justify-center overflow-hidden">
        {/* Alignment Grid Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293710_1px,transparent_1px),linear-gradient(to_bottom,#1f293710_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />

        {/* Phase Indicator & Mode Toggles */}
        <div className="w-full flex items-center justify-between z-10 mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-2 border border-line text-zinc-300 font-bold">
              {isBottom ? 'Phase: Bottom / Max Contraction' : 'Phase: Setup / Starting Alignment'}
            </span>
            <span className="text-[11px] font-mono text-lime-400 bg-lime-400/10 px-2 py-0.5 rounded border border-lime-400/30 font-bold">
              Active Form Model
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setIsPlayingAnimation(!isPlayingAnimation);
              }}
              className="px-2 py-1 bg-surface-2 hover:bg-surface-3 text-zinc-200 border border-line rounded-lg text-xs font-mono flex items-center gap-1"
            >
              {isPlayingAnimation ? <Pause className="w-3 h-3 text-amber-400" /> : <Play className="w-3 h-3 text-lime-400" />}
              <span>{isPlayingAnimation ? 'Pause' : 'Play Loop'}</span>
            </button>

            <button
              onClick={() => {
                setIsPlayingAnimation(false);
                setPosturePhase(isBottom ? 'setup' : 'bottom');
              }}
              className="px-2 py-1 bg-surface-2 hover:bg-surface-3 text-zinc-300 border border-line rounded-lg text-xs font-mono"
            >
              {isBottom ? 'View Setup' : 'View Depth'}
            </button>
          </div>
        </div>

        {/* Dynamic Vector Anatomical Mannequin */}
        <div className="w-full max-w-sm h-64 relative flex items-center justify-center">
          <svg viewBox="0 0 300 240" className="w-full h-full select-none">
            {/* Ground / Platform */}
            <line x1="20" y1="210" x2="280" y2="210" stroke="#374151" strokeWidth="3" strokeDasharray="4 4" />
            <text x="30" y="225" fill="#6b7280" fontSize="9" fontFamily="monospace">STABLE LIFTING PLATFORM</text>

            {/* Vertical Bar Path Line (Center of Gravity) */}
            <line x1="150" y1="30" x2="150" y2="210" stroke="#10b98140" strokeWidth="1.5" strokeDasharray="3 3" />
            <text x="155" y="45" fill="#10b981" fontSize="8" fontFamily="monospace">MIDFOOT CENTER OF MASS</text>

            {data.diagramType === 'squat' && (
              <g className="transition-all duration-300">
                {/* Feet */}
                <ellipse cx="150" cy="210" rx="20" ry="4" fill="#6b7280" />

                {/* Shins & Knees */}
                <line
                  x1="150"
                  y1="210"
                  x2={isBottom ? '175' : '155'}
                  y2={isBottom ? '165' : '135'}
                  stroke="#a3e635"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                <circle cx={isBottom ? '175' : '155'} cy={isBottom ? '165' : '135'} r="6" fill="#facc15" />

                {/* Thigh / Femur (Primary Quad) */}
                <line
                  x1={isBottom ? '175' : '155'}
                  y1={isBottom ? '165' : '135'}
                  x2={isBottom ? '125' : '148'}
                  y2={isBottom ? '165' : '85'}
                  stroke="#10b981"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
                <circle cx={isBottom ? '125' : '148'} cy={isBottom ? '165' : '85'} r="7" fill="#facc15" />

                {/* Torso / Spine (Neutral Alignment) */}
                <line
                  x1={isBottom ? '125' : '148'}
                  y1={isBottom ? '165' : '85'}
                  x2={isBottom ? '150' : '150'}
                  y2={isBottom ? '95' : '45'}
                  stroke="#38bdf8"
                  strokeWidth="8"
                  strokeLinecap="round"
                />

                {/* Head */}
                <circle cx={isBottom ? '158' : '150'} cy={isBottom ? '80' : '30'} r="11" fill="#9ca3af" />

                {/* Barbell Across Traps */}
                <line
                  x1="100"
                  y1={isBottom ? '95' : '45'}
                  x2="200"
                  y2={isBottom ? '95' : '45'}
                  stroke="#e2e8f0"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                {/* Weight Plates */}
                <rect x="92" y={isBottom ? '75' : '25'} width="8" height="40" rx="2" fill="#ef4444" />
                <rect x="200" y={isBottom ? '75' : '25'} width="8" height="40" rx="2" fill="#ef4444" />

                {/* Joint Angle Overlay Labels */}
                {isBottom ? (
                  <>
                    <text x="185" y="160" fill="#a3e635" fontSize="10" fontWeight="bold" fontFamily="monospace">
                      KNEE ~115°
                    </text>
                    <text x="75" y="165" fill="#38bdf8" fontSize="10" fontWeight="bold" fontFamily="monospace">
                      PARALLEL DEPTH
                    </text>
                    <text x="110" y="125" fill="#facc15" fontSize="9" fontFamily="monospace">
                      NEUTRAL SPINE
                    </text>
                  </>
                ) : (
                  <>
                    <text x="170" y="130" fill="#a3e635" fontSize="10" fontWeight="bold" fontFamily="monospace">
                      TALL STANCE
                    </text>
                    <text x="165" y="50" fill="#38bdf8" fontSize="10" fontWeight="bold" fontFamily="monospace">
                      TRAPS SHELF
                    </text>
                  </>
                )}
              </g>
            )}

            {data.diagramType === 'bench' && (
              <g className="transition-all duration-300">
                {/* Flat Bench Pad */}
                <rect x="50" y="140" width="200" height="15" rx="3" fill="#1f2937" stroke="#374151" strokeWidth="1" />
                {/* Bench Legs */}
                <rect x="65" y="155" width="10" height="55" fill="#111827" />
                <rect x="225" y="155" width="10" height="55" fill="#111827" />

                {/* Athlete Torso Arch */}
                <path
                  d="M 75 140 Q 120 125 180 140 L 195 185"
                  stroke="#38bdf8"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                />
                {/* Head on Bench */}
                <circle cx="65" cy="132" r="10" fill="#9ca3af" />
                {/* Feet Planted */}
                <line x1="195" y1="185" x2="195" y2="210" stroke="#6b7280" strokeWidth="6" strokeLinecap="round" />

                {/* Arms & Barbell */}
                <line
                  x1="120"
                  y1="130"
                  x2={isBottom ? '110' : '120'}
                  y2={isBottom ? '145' : '85'}
                  stroke="#a3e635"
                  strokeWidth="7"
                  strokeLinecap="round"
                />
                <circle cx={isBottom ? '110' : '120'} cy={isBottom ? '145' : '85'} r="5" fill="#facc15" />
                <line
                  x1={isBottom ? '110' : '120'}
                  y1={isBottom ? '145' : '85'}
                  x2={isBottom ? '125' : '125'}
                  y2={isBottom ? '120' : '60'}
                  stroke="#10b981"
                  strokeWidth="6"
                  strokeLinecap="round"
                />

                {/* Barbell */}
                <line
                  x1="60"
                  y1={isBottom ? '120' : '60'}
                  x2="190"
                  y2={isBottom ? '120' : '60'}
                  stroke="#e2e8f0"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                <rect x="52" y={isBottom ? '102' : '42'} width="8" height="36" rx="2" fill="#ef4444" />
                <rect x="190" y={isBottom ? '102' : '42'} width="8" height="36" rx="2" fill="#ef4444" />

                <text x="135" y={isBottom ? '115' : '55'} fill="#a3e635" fontSize="10" fontWeight="bold" fontFamily="monospace">
                  {isBottom ? 'STERNALLY TOUCHED (0.5s)' : 'ARMS STACKED AT LOCKOUT'}
                </text>
                <text x="90" y="165" fill="#38bdf8" fontSize="9" fontFamily="monospace">
                  ELBOWS TUCKED 45-75°
                </text>
              </g>
            )}

            {data.diagramType !== 'squat' && data.diagramType !== 'bench' && (
              <g className="transition-all duration-300">
                {/* Generic / Deadlift / Pull Model */}
                <ellipse cx="150" cy="210" rx="18" ry="4" fill="#6b7280" />
                {/* Legs */}
                <line x1="150" y1="210" x2="150" y2="135" stroke="#a3e635" strokeWidth="8" strokeLinecap="round" />
                {/* Torso */}
                <line
                  x1="150"
                  y1="135"
                  x2={isBottom ? '135' : '150'}
                  y2={isBottom ? '80' : '60'}
                  stroke="#10b981"
                  strokeWidth="9"
                  strokeLinecap="round"
                />
                {/* Head */}
                <circle cx={isBottom ? '130' : '150'} cy={isBottom ? '65' : '40'} r="11" fill="#9ca3af" />
                {/* Arms holding weight */}
                <line
                  x1={isBottom ? '135' : '150'}
                  y1={isBottom ? '80' : '60'}
                  x2={isBottom ? '145' : '150'}
                  y2={isBottom ? '130' : '100'}
                  stroke="#38bdf8"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
                {/* Barbell / Resistance */}
                <line
                  x1="100"
                  y1={isBottom ? '130' : '100'}
                  x2="200"
                  y2={isBottom ? '130' : '100'}
                  stroke="#e2e8f0"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                <rect x="92" y={isBottom ? '112' : '82'} width="8" height="36" rx="2" fill="#ef4444" />
                <rect x="200" y={isBottom ? '112' : '82'} width="8" height="36" rx="2" fill="#ef4444" />

                <text x="70" y="30" fill="#a3e635" fontSize="10" fontWeight="bold" fontFamily="monospace">
                  NEUTRAL SPINE CURVATURE
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* Anatomical Color Legend */}
        <div className="w-full mt-3 pt-2 border-t border-line flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-lime-400" />
            <span className="text-zinc-300">Primary Agonist</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
            <span className="text-zinc-300">Synergist Movement</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-zinc-300">Joint Pivots &amp; Stabilizers</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span className="text-zinc-300">Resistance Axis</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-surface border border-line rounded-2xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl relative my-auto space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-line">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-lime-400/15 border border-lime-400/30 text-lime-400 font-bold">
                Biomechanics &amp; Posture Guide
              </span>
              <span className="text-[11px] font-mono text-zinc-500 ">
                {data.category.replace('_', ' ')}
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-zinc-100 tracking-tight">
              {data.name}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Target: <strong className="text-lime-400">{data.primaryMuscles.join(', ')}</strong>
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-surface-3 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-1 p-1 bg-surface-2 border border-line rounded-xl overflow-x-auto text-xs font-semibold scrollbar-none">
          {[
            { id: 'visual' as const, label: 'Visual Model & Angles' },
            { id: 'checkpoints' as const, label: 'Step Checkpoints' },
            { id: 'mistakes' as const, label: 'Form Mistakes & Fixes' },
            { id: 'tempo' as const, label: 'Tempo & Breathing' },
            { id: 'ai_coach' as const, label: 'AI Form Coach' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-surface-3 text-lime-400 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB 1: VISUAL MODEL & JOINT ANGLES */}
        {activeTab === 'visual' && (
          <div className="space-y-4">
            {renderBiomechanicsCanvas()}

            {/* Joint Angles Table */}
            <div className="space-y-2">
              <h3 className="text-xs font-mono tracking-wide text-zinc-400 font-bold">
                Prescribed Joint Angles &amp; Alignment
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {data.jointAngles.map((ja, idx) => (
                  <div key={idx} className="p-2.5 bg-surface-2/60 border border-line rounded-lg space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-zinc-200">{ja.joint}</span>
                      <span className="font-mono text-[11px] text-lime-400 font-bold bg-lime-400/10 px-1.5 py-0.2 rounded">
                        {ja.recommendedAngle}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400">{ja.alignmentCue}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Setup Posture Cues */}
            <div className="p-3 bg-surface-2/40 border border-line rounded-xl space-y-2">
              <span className="text-[11px] font-mono text-zinc-400 font-semibold">
                Setup Protocol:
              </span>
              <ul className="space-y-1.5 text-xs text-zinc-300">
                {data.setupPosture.map((cue, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-lime-400 font-mono font-bold shrink-0">{idx + 1}.</span>
                    <span>{cue}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* TAB 2: STEP-BY-STEP CHECKPOINTS */}
        {activeTab === 'checkpoints' && (
          <div className="space-y-3">
            {data.checkpoints.map((cp, idx) => (
              <div key={idx} className="p-3.5 bg-surface-2/60 border border-line rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-100 text-xs sm:text-sm flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-lime-400/20 text-lime-400 text-xs flex items-center justify-center font-mono">
                      {idx + 1}
                    </span>
                    <span>{cp.phase}</span>
                  </span>
                  <span className="text-[11px] font-mono text-sky-400 bg-sky-400/10 px-2 py-0.5 rounded border border-sky-400/20">
                    {cp.anatomicalFocus}
                  </span>
                </div>
                <ul className="space-y-1 pl-7 text-xs text-zinc-300 list-disc">
                  {cp.cues.map((c, cIdx) => (
                    <li key={cIdx}>{c}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* TAB 3: COMMON MISTAKES & FIXES */}
        {activeTab === 'mistakes' && (
          <div className="space-y-3">
            {data.commonMistakes.map((m, idx) => (
              <div key={idx} className="p-3.5 bg-surface-2/70 border border-line rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-xs sm:text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{m.mistake}</span>
                  </div>
                  <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    m.dangerLevel === 'high' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-amber-500/20 text-amber-300'
                  }`}>
                    {m.dangerLevel} risk
                  </span>
                </div>

                <div className="text-[11px] text-zinc-400 leading-normal pl-6">
                  <strong className="text-zinc-300">Biomechanical hazard:</strong> {m.biomechanicalRisk}
                </div>

                <div className="p-2.5 bg-canvas border border-lime-500/30 rounded-lg flex items-start gap-2 text-xs text-zinc-200">
                  <CheckCircle2 className="w-4 h-4 text-lime-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-lime-400 font-mono text-[11px] block">Corrective Cue:</strong>
                    <span>{m.correction}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 4: TEMPO & BREATHING */}
        {activeTab === 'tempo' && (
          <div className="space-y-4">
            <div className="p-4 bg-surface-2/60 border border-line rounded-xl space-y-2">
              <span className="text-[11px] font-mono text-zinc-400 font-semibold">
                Recommended Hypertrophy Tempo:
              </span>
              <div className="text-base font-bold font-mono text-lime-400">
                {data.tempoRecommendation}
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Tempo controls time under tension, prevents momentum from masking weak links, and maximizes microtrauma on eccentric phases.
              </p>
            </div>

            <div className="p-4 bg-surface-2/60 border border-line rounded-xl space-y-2">
              <span className="text-[11px] font-mono text-zinc-400 font-semibold">
                Valsalva &amp; Intra-Abdominal Breathing Cue:
              </span>
              <p className="text-xs text-zinc-200 leading-relaxed">
                {data.breathingPattern}
              </p>
            </div>

            <div className="p-4 bg-surface-2/60 border border-line rounded-xl space-y-2">
              <span className="text-[11px] font-mono text-zinc-400 font-semibold">
                Joint Mobility Screening:
              </span>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {data.mobilityCheck}
              </p>
            </div>
          </div>
        )}

        {/* TAB 5: AI FORM COACH */}
        {activeTab === 'ai_coach' && (
          <div className="space-y-4">
            <div className="p-4 bg-surface-2/60 border border-lime-500/30 rounded-xl space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-lime-400" />
                <h3 className="font-bold text-zinc-100 text-sm">
                  Personalized AI Form Analysis for {data.name}
                </h3>
              </div>
              <p className="text-xs text-zinc-400">
                Ask Coach Iron about anatomical cues based on your limb length, joint history, or sticking points.
              </p>

              <div className="flex flex-wrap gap-1.5">
                {[
                  'Cues for long femurs & deep squats',
                  'Fixing shoulder clicking in this movement',
                  'Where should I feel the stretch?',
                  'How to prevent lower back pump?'
                ].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setAiCustomQuestion(prompt);
                      handleAskAiCoach(prompt);
                    }}
                    className="px-2.5 py-1 bg-canvas hover:bg-surface-3 border border-line text-zinc-300 rounded-lg text-xs"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <input
                  type="text"
                  value={aiCustomQuestion}
                  onChange={(e) => setAiCustomQuestion(e.target.value)}
                  placeholder="e.g. My knees cave in on rep 5, what cue fixes this?"
                  className="flex-1 px-3 py-2 bg-canvas border border-line rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-lime-400"
                />
                <button
                  onClick={() => handleAskAiCoach()}
                  disabled={isLoadingAiCues}
                  className="px-4 py-2 bg-lime-400 hover:bg-lime-300 text-accent-ink font-bold text-xs rounded-xl disabled:opacity-50 transition-colors shrink-0"
                >
                  {isLoadingAiCues ? 'Analyzing...' : 'Ask Coach'}
                </button>
              </div>

              {aiCustomCues && (
                <div className="mt-3 p-3.5 bg-canvas border border-lime-500/40 rounded-xl text-xs text-zinc-200 leading-relaxed space-y-2">
                  <div className="flex items-center gap-2 text-lime-400 font-mono font-bold text-[11px] ">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Coach Iron Biomechanical Feedback:</span>
                  </div>
                  <p className="whitespace-pre-line">{aiCustomCues}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-surface-3 hover:bg-zinc-700 text-zinc-200 font-bold text-xs rounded-xl transition-colors"
          >
            Close Form Guide
          </button>
        </div>
      </div>
    </div>
  );
};
