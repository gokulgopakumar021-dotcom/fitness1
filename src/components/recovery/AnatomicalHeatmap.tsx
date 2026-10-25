import React, { useState } from 'react';
import { MuscleGroupRecovery, SystemicRecoveryData } from '../../types';

interface AnatomicalHeatmapProps {
  recoveryData: SystemicRecoveryData;
  onSelectMuscleGroup?: (muscleGroup: string) => void;
}

export const AnatomicalHeatmap: React.FC<AnatomicalHeatmapProps> = ({
  recoveryData,
  onSelectMuscleGroup
}) => {
  const [selectedMuscle, setSelectedMuscle] = useState<string>('Chest');
  const [viewOrientation, setViewOrientation] = useState<'both' | 'front' | 'back'>('both');

  const getRecoveryForGroup = (groupName: string): MuscleGroupRecovery => {
    const found = recoveryData.muscleRecovery.find(
      (m) => m.muscleGroup.toLowerCase() === groupName.toLowerCase() ||
             m.muscleGroup.toLowerCase().includes(groupName.toLowerCase()) ||
             groupName.toLowerCase().includes(m.muscleGroup.toLowerCase())
    );

    if (found) return found;

    return {
      muscleGroup: groupName,
      recoveryPercentage: 100,
      status: 'fresh',
      totalSetsLast7Days: 0,
      recoveryTrend: 'stable',
      recoveryHoursRemaining: 0,
      exercisesTrained: []
    };
  };

  const getColorForRecovery = (percentage: number): { fill: string; stroke: string; label: string } => {
    if (percentage >= 85) {
      return { fill: '#CEFF00', stroke: '#a3cc00', label: 'Fresh' };
    }
    if (percentage >= 45) {
      return { fill: '#f59e0b', stroke: '#d97706', label: 'Recovering' };
    }
    return { fill: '#ef4444', stroke: '#dc2626', label: 'Fatigued' };
  };

  const activeMuscleData = getRecoveryForGroup(selectedMuscle);
  const activeColor = getColorForRecovery(activeMuscleData.recoveryPercentage);

  const handleMuscleClick = (name: string) => {
    setSelectedMuscle(name);
    if (onSelectMuscleGroup) {
      onSelectMuscleGroup(name);
    }
  };

  // Color mappings for SVG elements
  const chestColor = getColorForRecovery(getRecoveryForGroup('Chest').recoveryPercentage);
  const backColor = getColorForRecovery(getRecoveryForGroup('Back / Lats').recoveryPercentage);
  const shouldersColor = getColorForRecovery(getRecoveryForGroup('Shoulders').recoveryPercentage);
  const armsColor = getColorForRecovery(getRecoveryForGroup('Arms (Biceps & Triceps)').recoveryPercentage);
  const quadsColor = getColorForRecovery(getRecoveryForGroup('Quads').recoveryPercentage);
  const hamsGlutesColor = getColorForRecovery(getRecoveryForGroup('Hamstrings & Glutes').recoveryPercentage);
  const coreColor = getColorForRecovery(getRecoveryForGroup('Core & Lower Back').recoveryPercentage);

  return (
    <div className="reshape-card p-5 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-card)] pb-4">
        <div>
          <div className="text-[11px] font-mono tracking-wide text-[var(--text-muted)] flex items-center gap-1.5">
            <span>Anatomical Biomechanics</span>
            <span aria-hidden="true">·</span>
            <span className="text-volt-adaptive font-semibold">Muscle Readiness Heatmap</span>
          </div>
          <h3 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
            Tissue Fatigue & Hypertrophy Recovery
          </h3>
        </div>

        {/* Orientation selector */}
        <div className="flex items-center bg-[var(--chip-bg)] rounded-lg p-0.5 border border-[var(--border-card)]">
          <button
            type="button"
            onClick={() => setViewOrientation('both')}
            className={`px-3 py-1 text-xs font-semibold rounded ${
              viewOrientation === 'both' ? 'bg-accent text-accent-ink font-bold' : 'text-[var(--text-muted)]'
            }`}
          >
            All Views
          </button>
          <button
            type="button"
            onClick={() => setViewOrientation('front')}
            className={`px-3 py-1 text-xs font-semibold rounded ${
              viewOrientation === 'front' ? 'bg-accent text-accent-ink font-bold' : 'text-[var(--text-muted)]'
            }`}
          >
            Anterior (Front)
          </button>
          <button
            type="button"
            onClick={() => setViewOrientation('back')}
            className={`px-3 py-1 text-xs font-semibold rounded ${
              viewOrientation === 'back' ? 'bg-accent text-accent-ink font-bold' : 'text-[var(--text-muted)]'
            }`}
          >
            Posterior (Back)
          </button>
        </div>
      </div>

      {/* Main Grid: Body Vector + Inspector Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Heatmap Body Views */}
        <div className={`lg:col-span-7 flex flex-wrap justify-around items-center p-4 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)] gap-6 min-h-[360px]`}>
          {/* Anterior (Front) View */}
          {(viewOrientation === 'both' || viewOrientation === 'front') && (
            <div className="flex flex-col items-center">
              <span className="text-[11px] font-mono tracking-wide text-[var(--text-muted)] mb-2">
                Anterior (Front)
              </span>
              <svg viewBox="0 0 160 300" className="w-36 h-72 select-none filter drop-shadow-md">
                {/* Silhouette Base Human Outline */}
                <path
                  d="M80 15 C87 15 92 20 92 28 C92 36 86 42 80 42 C74 42 68 36 68 28 C68 20 73 15 80 15 Z"
                  fill="#27272a"
                  stroke="#3f3f46"
                  strokeWidth="1.5"
                />
                {/* Neck */}
                <rect x="76" y="42" width="8" height="8" fill="#27272a" />

                {/* Trapezius / Neck base */}
                <path d="M68 50 L92 50 L102 56 L58 56 Z" fill="#3f3f46" opacity="0.6" />

                {/* Shoulders (Deltoids - Front) */}
                <path
                  d="M56 56 Q48 60 46 72 Q54 75 58 66 Z"
                  fill={shouldersColor.fill}
                  stroke={shouldersColor.stroke}
                  strokeWidth="1.2"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Shoulders')}
                />
                <path
                  d="M104 56 Q112 60 114 72 Q106 75 102 66 Z"
                  fill={shouldersColor.fill}
                  stroke={shouldersColor.stroke}
                  strokeWidth="1.2"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Shoulders')}
                />

                {/* Chest (Pectorals) */}
                <path
                  d="M58 58 L78 60 L78 82 Q66 84 58 74 Z"
                  fill={chestColor.fill}
                  stroke={chestColor.stroke}
                  strokeWidth="1.5"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Chest')}
                />
                <path
                  d="M102 58 L82 60 L82 82 Q94 84 102 74 Z"
                  fill={chestColor.fill}
                  stroke={chestColor.stroke}
                  strokeWidth="1.5"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Chest')}
                />

                {/* Biceps & Forearms */}
                <path
                  d="M45 74 Q42 88 44 102 Q50 102 52 88 Z"
                  fill={armsColor.fill}
                  stroke={armsColor.stroke}
                  strokeWidth="1.2"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Arms (Biceps & Triceps)')}
                />
                <path
                  d="M115 74 Q118 88 116 102 Q110 102 108 88 Z"
                  fill={armsColor.fill}
                  stroke={armsColor.stroke}
                  strokeWidth="1.2"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Arms (Biceps & Triceps)')}
                />
                {/* Forearms */}
                <path d="M43 104 Q39 122 41 140 Q47 140 48 122 Z" fill="#3f3f46" opacity="0.8" />
                <path d="M117 104 Q121 122 119 140 Q113 140 112 122 Z" fill="#3f3f46" opacity="0.8" />

                {/* Core & Abdominals */}
                <path
                  d="M66 86 L94 86 L92 128 L68 128 Z"
                  fill={coreColor.fill}
                  stroke={coreColor.stroke}
                  strokeWidth="1.2"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Core & Lower Back')}
                />

                {/* Pelvis & Hips */}
                <path d="M66 128 L94 128 L96 142 L64 142 Z" fill="#27272a" />

                {/* Quads (Quadriceps) */}
                <path
                  d="M64 144 Q60 178 64 210 Q76 210 78 178 Q78 152 74 144 Z"
                  fill={quadsColor.fill}
                  stroke={quadsColor.stroke}
                  strokeWidth="1.5"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Quads')}
                />
                <path
                  d="M96 144 Q100 178 96 210 Q84 210 82 178 Q82 152 86 144 Z"
                  fill={quadsColor.fill}
                  stroke={quadsColor.stroke}
                  strokeWidth="1.5"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Quads')}
                />

                {/* Knees */}
                <circle cx="69" cy="216" r="5" fill="#3f3f46" />
                <circle cx="91" cy="216" r="5" fill="#3f3f46" />

                {/* Calves (Anterior) */}
                <path d="M64 224 Q60 250 65 278 Q73 278 74 250 Z" fill="#3f3f46" opacity="0.8" />
                <path d="M96 224 Q100 250 95 278 Q87 278 86 250 Z" fill="#3f3f46" opacity="0.8" />
              </svg>
            </div>
          )}

          {/* Posterior (Back) View */}
          {(viewOrientation === 'both' || viewOrientation === 'back') && (
            <div className="flex flex-col items-center">
              <span className="text-[11px] font-mono tracking-wide text-[var(--text-muted)] mb-2">
                Posterior (Back)
              </span>
              <svg viewBox="0 0 160 300" className="w-36 h-72 select-none filter drop-shadow-md">
                {/* Head (Back) */}
                <path
                  d="M80 15 C87 15 92 20 92 28 C92 36 86 42 80 42 C74 42 68 36 68 28 C68 20 73 15 80 15 Z"
                  fill="#27272a"
                  stroke="#3f3f46"
                  strokeWidth="1.5"
                />
                <rect x="76" y="42" width="8" height="8" fill="#27272a" />

                {/* Trapezius / Upper Back */}
                <path
                  d="M60 52 L100 52 L92 84 L68 84 Z"
                  fill={backColor.fill}
                  stroke={backColor.stroke}
                  strokeWidth="1.5"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Back / Lats')}
                />

                {/* Rear Deltoids */}
                <path
                  d="M56 56 Q48 60 46 72 Q54 75 58 66 Z"
                  fill={shouldersColor.fill}
                  stroke={shouldersColor.stroke}
                  strokeWidth="1.2"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Shoulders')}
                />
                <path
                  d="M104 56 Q112 60 114 72 Q106 75 102 66 Z"
                  fill={shouldersColor.fill}
                  stroke={shouldersColor.stroke}
                  strokeWidth="1.2"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Shoulders')}
                />

                {/* Triceps */}
                <path
                  d="M45 74 Q42 88 44 102 Q50 102 52 88 Z"
                  fill={armsColor.fill}
                  stroke={armsColor.stroke}
                  strokeWidth="1.2"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Arms (Biceps & Triceps)')}
                />
                <path
                  d="M115 74 Q118 88 116 102 Q110 102 108 88 Z"
                  fill={armsColor.fill}
                  stroke={armsColor.stroke}
                  strokeWidth="1.2"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Arms (Biceps & Triceps)')}
                />

                {/* Lats (Latissimus Dorsi) */}
                <path
                  d="M64 80 L96 80 L88 116 L72 116 Z"
                  fill={backColor.fill}
                  stroke={backColor.stroke}
                  strokeWidth="1.5"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Back / Lats')}
                />

                {/* Lower Back / Erectors */}
                <path
                  d="M72 116 L88 116 L86 134 L74 134 Z"
                  fill={coreColor.fill}
                  stroke={coreColor.stroke}
                  strokeWidth="1.2"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Core & Lower Back')}
                />

                {/* Glutes */}
                <path
                  d="M64 134 L96 134 Q98 158 80 162 Q62 158 64 134 Z"
                  fill={hamsGlutesColor.fill}
                  stroke={hamsGlutesColor.stroke}
                  strokeWidth="1.5"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Hamstrings & Glutes')}
                />

                {/* Hamstrings */}
                <path
                  d="M64 164 Q60 188 66 210 Q76 210 78 188 Q76 168 74 164 Z"
                  fill={hamsGlutesColor.fill}
                  stroke={hamsGlutesColor.stroke}
                  strokeWidth="1.5"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Hamstrings & Glutes')}
                />
                <path
                  d="M96 164 Q100 188 94 210 Q84 210 82 188 Q84 168 86 164 Z"
                  fill={hamsGlutesColor.fill}
                  stroke={hamsGlutesColor.stroke}
                  strokeWidth="1.5"
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleMuscleClick('Hamstrings & Glutes')}
                />

                {/* Calves (Gastrocnemius & Soleus) */}
                <path
                  d="M64 222 Q58 248 66 278 Q74 278 76 248 Z"
                  fill="#3f3f46"
                  stroke="#52525b"
                  strokeWidth="1.2"
                  opacity="0.85"
                />
                <path
                  d="M96 222 Q102 248 94 278 Q86 278 84 248 Z"
                  fill="#3f3f46"
                  stroke="#52525b"
                  strokeWidth="1.2"
                  opacity="0.85"
                />
              </svg>
            </div>
          )}
        </div>

        {/* Selected Muscle Inspector Drawer */}
        <div className="lg:col-span-5 space-y-4">
          <div className="reshape-card-subtle p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-card)] pb-3">
              <div>
                <span className="text-[11px] font-mono tracking-wide text-[var(--text-muted)]">
                  Selected Target Group
                </span>
                <h4 className="text-base font-bold text-[var(--text-primary)]">
                  {selectedMuscle}
                </h4>
              </div>
              <span
                style={{ backgroundColor: `${activeColor.fill}20`, color: activeColor.fill }}
                className="px-2.5 py-1 rounded text-xs font-mono font-bold tracking-wide border border-current"
              >
                {activeMuscleData.recoveryPercentage}% {activeColor.label}
              </span>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="p-3 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                <div className="text-[11px] text-[var(--text-muted)] ">Hours Since Trained</div>
                <div className="text-sm font-bold text-[var(--text-primary)] mt-0.5">
                  {activeMuscleData.hoursSinceLastTrained !== undefined
                    ? `${activeMuscleData.hoursSinceLastTrained}h ago`
                    : 'Restored (7+ days)'}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                <div className="text-[11px] text-[var(--text-muted)] ">7-Day Volume Sets</div>
                <div className="text-sm font-bold text-[var(--text-primary)] mt-0.5">
                  {activeMuscleData.totalSetsLast7Days} sets
                </div>
              </div>
            </div>

            {/* Prescriptive Recommendation */}
            <div className="text-xs leading-relaxed text-[var(--text-secondary)] bg-[var(--bg-canvas)] p-3.5 rounded-lg border border-[var(--border-card)]">
              <span className="font-bold text-[var(--text-primary)] block mb-1">
                Hypertrophy Readiness Verdict:
              </span>
              {activeMuscleData.recoveryPercentage >= 85 ? (
                <span>
                  Muscle fibers are fully supercompensated and glycogen-replete. Prime state for high mechanical tension, progressive overload attempts, or PR sets.
                </span>
              ) : activeMuscleData.recoveryPercentage >= 45 ? (
                <span>
                  Active recovery in progress (~{activeMuscleData.recoveryHoursRemaining}h remaining). Suitable for moderate secondary work, light technique, or active blood flow.
                </span>
              ) : (
                <span>
                  Elevated tissue micro-trauma from recent stimulus. Heavy axial loading is contraindicated today; prioritize protein synthesis and 8+ hours sleep.
                </span>
              )}
            </div>

            {/* Exercises Logged */}
            {activeMuscleData.exercisesTrained.length > 0 && (
              <div>
                <span className="text-[11px] font-mono tracking-wide text-[var(--text-muted)] block mb-1.5">
                  Recent Movements Performed
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {activeMuscleData.exercisesTrained.map((ex, i) => (
                    <span
                      key={i}
                      className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--chip-bg)] text-[var(--text-secondary)] border border-[var(--border-card)]"
                    >
                      {ex}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="pt-2 border-t border-[var(--border-card)] flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-accent"></span> Fresh (≥85%)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-warning"></span> Recovering
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-danger"></span> Fatigued (&lt;45%)
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
