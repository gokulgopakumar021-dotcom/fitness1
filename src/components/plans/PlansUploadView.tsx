import React, { useState, useEffect, useRef } from 'react';
import {
  FileSpreadsheet,
  Upload,
  FileText,
  Image,
  File,
  CheckCircle,
  AlertTriangle,
  Plus,
  Trash2,
  Edit2,
  Copy,
  Check,
  ChevronDown,
  Sparkles,
  ArrowRight,
  RefreshCw,
  FolderOpen,
  TrendingUp,
  Sliders
} from 'lucide-react';
import {
  EquipmentType,
  PlannedExercise,
  ProgressionStrategy,
  UploadedDoc,
  UserProfile,
  WorkoutDay,
  WorkoutPlan
} from '../../types';
import { db } from '../../storage/db';

interface PlansUploadProps {
  profile: UserProfile;
  onPlanActivated: (planId: string) => void;
  onNavigateToProgression?: (planId: string) => void;
}

export const PlansUploadView: React.FC<PlansUploadProps> = ({
  profile,
  onPlanActivated,
  onNavigateToProgression
}) => {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);

  // Active view: 'plans_list' | 'upload_file' | 'review_extracted' | 'manual_builder'
  const [subView, setSubView] = useState<
    'plans_list' | 'upload_file' | 'review_extracted' | 'manual_builder'
  >('plans_list');

  // File upload state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Review & Correction state for extracted plan
  const [reviewPlan, setReviewPlan] = useState<WorkoutPlan | null>(null);
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);

  // Manual builder state
  const [builderPlanName, setBuilderPlanName] = useState<string>('My Custom Routine');
  const [builderSplit, setBuilderSplit] = useState<string>('Push / Pull / Legs');
  const [builderDays, setBuilderDays] = useState<WorkoutDay[]>([
    {
      id: `day-${Date.now()}-1`,
      dayName: 'Day 1 — Push',
      dayOrder: 1,
      exercises: [
        {
          id: `ex-${Date.now()}-1`,
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          equipment: 'barbell',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 120
        }
      ]
    }
  ]);

  // Confirmation modal for Replace Active Plan
  const [showReplaceModal, setShowReplaceModal] = useState<boolean>(false);

  useEffect(() => {
    setPlans(db.getPlans());
    setActivePlanId(db.getActivePlanId());
    setUploadedDocs(db.getUploadedDocs());
  }, []);

  const refreshPlans = () => {
    setPlans(db.getPlans());
    setActivePlanId(db.getActivePlanId());
    setUploadedDocs(db.getUploadedDocs());
  };

  // Activate a plan
  const handleActivatePlan = (planId: string) => {
    db.setActivePlanId(planId);
    setActivePlanId(planId);
    onPlanActivated(planId);
    // Mark in plans array
    const updated = plans.map((p) => ({
      ...p,
      isActive: p.id === planId
    }));
    db.savePlans(updated);
    setPlans(updated);
  };

  // Duplicate a plan
  const handleDuplicatePlan = (sourcePlan: WorkoutPlan) => {
    const duplicated: WorkoutPlan = {
      ...sourcePlan,
      id: `plan-${Date.now()}`,
      name: `${sourcePlan.name} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: false,
      isStarter: false
    };
    const updated = [...plans, duplicated];
    db.savePlans(updated);
    setPlans(updated);
  };

  // Delete a plan
  const handleDeletePlan = (planId: string) => {
    const remaining = plans.filter((p) => p.id !== planId);
    db.savePlans(remaining);
    setPlans(remaining);
    if (activePlanId === planId) {
      db.setActivePlanId(null);
      setActivePlanId(null);
    }
  };

  // Client-side CSV / Text Parser fallback
  const parseCSVPlanLocally = (csvText: string, fileName: string): WorkoutPlan => {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const daysMap = new Map<string, PlannedExercise[]>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip header if line has "exercise" or "day"
      if (i === 0 && (line.toLowerCase().includes('exercise') || line.toLowerCase().includes('day'))) {
        continue;
      }
      const parts = line.split(',').map((p) => p.replace(/^"|"$/g, '').trim());
      if (parts.length < 2) continue;

      const dayName = parts[0] || 'Day 1';
      const exName = parts[1] || 'Exercise';
      const sets = parseInt(parts[2], 10) || 3;
      const reps = parts[3] || '8-12';
      const rest = parseInt(parts[4], 10) || 90;

      const ex: PlannedExercise = {
        id: `csv-ex-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        name: exName,
        muscleGroup: 'General',
        equipment: 'barbell',
        workingSets: sets,
        repRange: reps,
        targetRir: 2,
        restSeconds: rest
      };

      if (!daysMap.has(dayName)) {
        daysMap.set(dayName, []);
      }
      daysMap.get(dayName)!.push(ex);
    }

    const days: WorkoutDay[] = [];
    let order = 1;
    daysMap.forEach((exercises, dayName) => {
      days.push({
        id: `csv-day-${Date.now()}-${order}`,
        dayName,
        dayOrder: order++,
        exercises
      });
    });

    return {
      id: `imported-${Date.now()}`,
      name: fileName.replace(/\.[^/.]+$/, ''),
      trainingSplit: 'Custom CSV Import',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: false,
      isUploaded: true,
      days
    };
  };

  // Upload handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setUploadError(null);

    const docId = `doc-${Date.now()}`;
    const newDoc: UploadedDoc = {
      id: docId,
      fileName: file.name,
      fileType: file.type || file.name.split('.').pop() || 'unknown',
      fileSize: file.size,
      uploadDate: new Date().toISOString(),
      status: 'pending'
    };
    db.addUploadedDoc(newDoc);
    setCurrentDocId(docId);

    try {
      const isCSV = file.name.endsWith('.csv') || file.type.includes('csv');
      const isJSON = file.name.endsWith('.json') || file.type.includes('json');
      const isText = file.name.endsWith('.txt') || file.type.includes('text');

      if (isJSON) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (parsed.days && Array.isArray(parsed.days)) {
          const importedPlan: WorkoutPlan = {
            id: `plan-${Date.now()}`,
            name: parsed.name || file.name.replace(/\.json$/, ''),
            trainingSplit: parsed.trainingSplit || 'Custom JSON Plan',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isActive: false,
            isUploaded: true,
            days: parsed.days
          };
          setReviewPlan(importedPlan);
          setSubView('review_extracted');
          setIsProcessing(false);
          return;
        }
      }

      if (isCSV) {
        const text = await file.text();
        const csvPlan = parseCSVPlanLocally(text, file.name);
        setReviewPlan(csvPlan);
        setSubView('review_extracted');
        setIsProcessing(false);
        return;
      }

      // If document or image or PDF, attempt API extraction
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = reader.result as string;
          let fileBase64 = '';
          if (result.includes(',')) {
            fileBase64 = result.split(',')[1];
          }

          const res = await fetch('/api/extract-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileData: fileBase64,
              mimeType: file.type || 'application/pdf',
              fileName: file.name
            })
          });

          const data = await res.json();
          if (data.success && data.plan) {
            const extractedPlan: WorkoutPlan = {
              id: `plan-extracted-${Date.now()}`,
              name: data.plan.planName || file.name.replace(/\.[^/.]+$/, ''),
              trainingSplit: data.plan.trainingSplit || 'Extracted Routine',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              isActive: false,
              isUploaded: true,
              days: (data.plan.days || []).map((d: any, idx: number) => ({
                id: `day-${Date.now()}-${idx}`,
                dayName: d.dayName || `Day ${idx + 1}`,
                dayOrder: idx + 1,
                exercises: (d.exercises || []).map((ex: any, exIdx: number) => ({
                  id: `ex-${Date.now()}-${idx}-${exIdx}`,
                  name: ex.name || 'Exercise',
                  muscleGroup: ex.muscleGroup || 'General',
                  equipment: (ex.equipment || 'barbell').toLowerCase() as EquipmentType,
                  workingSets: ex.workingSets || 3,
                  repRange: ex.repRange || '8-12',
                  targetRir: ex.targetRir ?? 2,
                  restSeconds: ex.restSeconds || 90,
                  notes: ex.notes || ''
                }))
              }))
            };

            setReviewPlan(extractedPlan);
            setSubView('review_extracted');
          } else {
            // Extraction failed explicitly - Never pretend it succeeded
            setUploadError(
              data.error ||
                'Automatic extraction could not parse this document into exercises. Please use the manual plan builder or upload a structured CSV.'
            );
            // Update document status
            const docs = db.getUploadedDocs();
            const d = docs.find((x) => x.id === docId);
            if (d) {
              d.status = 'failed';
              d.errorMessage = data.error;
              db.saveUploadedDocs(docs);
            }
          }
        } catch (err: any) {
          setUploadError(
            err?.message ||
              'Extraction network request failed. You can build your plan manually using the Plan Builder.'
          );
        } finally {
          setIsProcessing(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setUploadError(err?.message || 'Failed reading file');
      setIsProcessing(false);
    }
  };

  // Import options
  const handleImportAsNewPlan = () => {
    if (!reviewPlan) return;
    const newPlan: WorkoutPlan = {
      ...reviewPlan,
      id: `plan-${Date.now()}`,
      isActive: false
    };
    const updated = [...plans, newPlan];
    db.savePlans(updated);
    setPlans(updated);
    setSubView('plans_list');
  };

  const handleImportAndTuneOverload = () => {
    if (!reviewPlan) return;
    const newPlan: WorkoutPlan = {
      ...reviewPlan,
      id: `plan-${Date.now()}`,
      isActive: false
    };
    const updated = [...plans, newPlan];
    db.savePlans(updated);
    setPlans(updated);
    setSubView('plans_list');
    if (onNavigateToProgression) {
      onNavigateToProgression(newPlan.id);
    }
  };

  const handleImportAndReplaceActive = () => {
    if (!reviewPlan) return;
    const newPlan: WorkoutPlan = {
      ...reviewPlan,
      id: `plan-${Date.now()}`,
      isActive: true
    };
    const updated = plans.map((p) => ({ ...p, isActive: false }));
    updated.push(newPlan);
    db.savePlans(updated);
    db.setActivePlanId(newPlan.id);
    setActivePlanId(newPlan.id);
    setPlans(updated);
    onPlanActivated(newPlan.id);
    setShowReplaceModal(false);
    setSubView('plans_list');
  };

  // Manual builder handlers
  const handleAddBuilderDay = () => {
    const newDay: WorkoutDay = {
      id: `day-${Date.now()}`,
      dayName: `Day ${builderDays.length + 1}`,
      dayOrder: builderDays.length + 1,
      exercises: []
    };
    setBuilderDays([...builderDays, newDay]);
  };

  const handleAddBuilderExercise = (dayIdx: number) => {
    const days = [...builderDays];
    days[dayIdx].exercises.push({
      id: `ex-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: 'New Exercise',
      muscleGroup: 'Chest',
      equipment: 'barbell',
      workingSets: 3,
      repRange: '8-12',
      targetRir: 2,
      restSeconds: 90
    });
    setBuilderDays(days);
  };

  const handleSaveManualPlan = () => {
    const newPlan: WorkoutPlan = {
      id: `plan-manual-${Date.now()}`,
      name: builderPlanName.trim() || 'Custom Routine',
      trainingSplit: builderSplit.trim() || 'Custom',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: false,
      days: builderDays
    };
    const updated = [...plans, newPlan];
    db.savePlans(updated);
    setPlans(updated);
    setSubView('plans_list');
  };

  // ==========================================
  // SUBVIEW: REVIEW EXTRACTED PLAN
  // ==========================================
  if (subView === 'review_extracted' && reviewPlan) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto pb-16">
        <div className="bg-[#090c12] border border-white/[0.08] rounded-2xl p-5 lg:p-7 shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[0.06]">
            <div>
              <div className="flex items-center gap-2 text-[#CEFF00] text-xs font-mono font-bold uppercase tracking-widest mb-1.5">
                <CheckCircle className="w-4 h-4" />
                <span>Verification &amp; Correction Step</span>
              </div>
              <h2 className="text-xl lg:text-2xl font-extrabold text-white tracking-tight">
                Review Extracted Workout Plan
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Verify exercises, rep ranges, and training days before importing to your library.
              </p>
            </div>

            <button
              onClick={() => setSubView('plans_list')}
              className="min-h-[44px] px-3.5 py-2 bg-white/[0.06] text-zinc-300 hover:text-white text-xs font-semibold rounded-xl self-start sm:self-auto transition-colors"
            >
              Cancel Review
            </button>
          </div>

          {/* Plan Name & Split Edit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1">Plan Name</label>
              <input
                type="text"
                value={reviewPlan.name}
                onChange={(e) => setReviewPlan({ ...reviewPlan, name: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-100 font-bold"
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1">Training Split</label>
              <input
                type="text"
                value={reviewPlan.trainingSplit}
                onChange={(e) => setReviewPlan({ ...reviewPlan, trainingSplit: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-100"
              />
            </div>
          </div>

          {/* Overload Strategy & Phase Calibration during Review */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-zinc-900/60 border border-zinc-800 p-3.5 rounded-xl">
            <div>
              <label className="block text-zinc-300 mb-1 font-semibold flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-lime-400" />
                <span>Overload Progression Strategy</span>
              </label>
              <select
                value={reviewPlan.defaultStrategy || 'double_progression'}
                onChange={(e) => setReviewPlan({ ...reviewPlan, defaultStrategy: e.target.value as any })}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 font-medium"
              >
                <option value="double_progression">Standard Double Progression (All Sets Top of Range)</option>
                <option value="top_set_only">Top-Set Only Progression</option>
                <option value="consecutive_sessions">Dual-Session Consolidation</option>
                <option value="linear_load">Linear Micro-Load (+2.5kg Weekly)</option>
              </select>
            </div>
            <div>
              <label className="block text-zinc-300 mb-1 font-semibold">
                Initial Training Phase
              </label>
              <select
                value={reviewPlan.progressionPhase || 'hypertrophy'}
                onChange={(e) => setReviewPlan({ ...reviewPlan, progressionPhase: e.target.value as any })}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 capitalize font-medium"
              >
                <option value="hypertrophy">Hypertrophy (Progressive Overload)</option>
                <option value="strength">Strength (Lower Reps, Heavy Compound)</option>
                <option value="adaptation">Adaptation (Ramp-up / Form Focus)</option>
                <option value="deload">Deload (-25% Load Reduction)</option>
              </select>
            </div>
          </div>

          {/* Days & Exercises Review */}
          <div className="space-y-4 pt-3">
            {reviewPlan.days.map((day, dIdx) => (
              <div
                key={day.id}
                className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <input
                    type="text"
                    value={day.dayName}
                    onChange={(e) => {
                      const days = [...reviewPlan.days];
                      days[dIdx].dayName = e.target.value;
                      setReviewPlan({ ...reviewPlan, days });
                    }}
                    className="font-bold text-zinc-100 bg-transparent border-b border-zinc-700 text-sm pb-1 w-full max-w-xs focus:outline-none focus:border-lime-400"
                  />
                  <button
                    onClick={() => {
                      const days = reviewPlan.days.filter((_, idx) => idx !== dIdx);
                      setReviewPlan({ ...reviewPlan, days });
                    }}
                    className="text-zinc-500 hover:text-rose-400 text-xs p-1"
                    title="Remove day"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Exercises in this day */}
                <div className="space-y-2">
                  {day.exercises.map((ex, exIdx) => (
                    <div
                      key={ex.id}
                      className="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-lg grid grid-cols-1 sm:grid-cols-12 gap-2 items-center text-xs"
                    >
                      <div className="sm:col-span-4">
                        <input
                          type="text"
                          value={ex.name}
                          onChange={(e) => {
                            const days = [...reviewPlan.days];
                            days[dIdx].exercises[exIdx].name = e.target.value;
                            setReviewPlan({ ...reviewPlan, days });
                          }}
                          className="w-full bg-transparent text-zinc-200 font-bold focus:outline-none"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          type="text"
                          value={ex.muscleGroup}
                          onChange={(e) => {
                            const days = [...reviewPlan.days];
                            days[dIdx].exercises[exIdx].muscleGroup = e.target.value;
                            setReviewPlan({ ...reviewPlan, days });
                          }}
                          placeholder="Muscle"
                          className="w-full bg-transparent text-zinc-400 text-[11px] focus:outline-none"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          type="number"
                          value={ex.workingSets}
                          onChange={(e) => {
                            const days = [...reviewPlan.days];
                            days[dIdx].exercises[exIdx].workingSets = parseInt(e.target.value, 10) || 3;
                            setReviewPlan({ ...reviewPlan, days });
                          }}
                          placeholder="Sets"
                          className="w-16 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 font-mono text-[11px]"
                        />
                        <span className="text-[10px] text-zinc-500 ml-1">sets</span>
                      </div>
                      <div className="sm:col-span-3">
                        <input
                          type="text"
                          value={ex.repRange}
                          onChange={(e) => {
                            const days = [...reviewPlan.days];
                            days[dIdx].exercises[exIdx].repRange = e.target.value;
                            setReviewPlan({ ...reviewPlan, days });
                          }}
                          placeholder="8-12 reps"
                          className="w-20 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 font-mono text-[11px]"
                        />
                        <span className="text-[10px] text-zinc-500 ml-1">reps</span>
                      </div>
                      <div className="sm:col-span-1 text-right">
                        <button
                          onClick={() => {
                            const days = [...reviewPlan.days];
                            days[dIdx].exercises = days[dIdx].exercises.filter((_, idx) => idx !== exIdx);
                            setReviewPlan({ ...reviewPlan, days });
                          }}
                          className="text-zinc-600 hover:text-rose-400 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => {
                    const days = [...reviewPlan.days];
                    days[dIdx].exercises.push({
                      id: `ex-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                      name: 'New Exercise',
                      muscleGroup: 'Chest',
                      equipment: 'barbell',
                      workingSets: 3,
                      repRange: '8-12',
                      targetRir: 2,
                      restSeconds: 90
                    });
                    setReviewPlan({ ...reviewPlan, days });
                  }}
                  className="text-xs text-[#CEFF00] hover:underline flex items-center gap-1 font-bold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Exercise to this Day</span>
                </button>
              </div>
            ))}
          </div>

          {/* Import Decision Actions */}
          <div className="pt-5 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-zinc-400 font-mono">
              Total: {reviewPlan.days.length} Days &middot;{' '}
              {reviewPlan.days.reduce((acc, d) => acc + d.exercises.length, 0)} Exercises
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleImportAsNewPlan}
                className="min-h-[44px] px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 font-bold rounded-xl transition-colors"
              >
                Import as Library Plan
              </button>
              <button
                onClick={handleImportAndTuneOverload}
                className="min-h-[44px] px-4 py-2 bg-[#CEFF00]/15 hover:bg-[#CEFF00]/25 border border-[#CEFF00]/40 text-[#CEFF00] font-bold rounded-xl transition-colors flex items-center gap-1.5"
              >
                <TrendingUp className="w-3.5 h-3.5 text-[#CEFF00]" />
                <span>Import &amp; Tune Overload Analytics</span>
              </button>
              <button
                onClick={() => setShowReplaceModal(true)}
                className="min-h-[44px] touch-press px-5 py-2 bg-[#CEFF00] hover:bg-[#b8e600] text-black font-extrabold rounded-xl transition-all shadow-lg active:scale-[0.98]"
              >
                Import &amp; Set as Active Plan
              </button>
            </div>
          </div>
        </div>

        {/* Confirmation Modal to Replace Active Plan */}
        {showReplaceModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-[#090c12] border border-white/[0.12] rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-amber-400">
                <AlertTriangle className="w-6 h-6" />
                <h3 className="font-extrabold text-white text-base">Replace Active Plan?</h3>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                This will set <strong className="text-white">{reviewPlan.name}</strong> as your active routine for today&apos;s workout tracker. Your other saved plans remain preserved in your library.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowReplaceModal(false)}
                  className="min-h-[44px] px-3.5 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImportAndReplaceActive}
                  className="min-h-[44px] px-5 py-2 bg-[#CEFF00] hover:bg-[#b8e600] text-black font-extrabold rounded-xl text-xs shadow-lg"
                >
                  Confirm &amp; Activate
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // SUBVIEW: MANUAL PLAN BUILDER
  // ==========================================
  if (subView === 'manual_builder') {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 lg:p-7 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-zinc-800/80">
            <div>
              <h2 className="text-xl font-bold text-zinc-100">Manual Workout Plan Builder</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Construct your training split, prescribe working sets, rep ranges, and rest intervals.
              </p>
            </div>
            <button
              onClick={() => setSubView('plans_list')}
              className="px-3 py-1.5 bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs rounded-lg"
            >
              Back to Plans
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1">Plan Name</label>
              <input
                type="text"
                value={builderPlanName}
                onChange={(e) => setBuilderPlanName(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-100 font-bold"
              />
            </div>
            <div>
              <label className="block text-zinc-400 mb-1">Training Split</label>
              <input
                type="text"
                value={builderSplit}
                onChange={(e) => setBuilderSplit(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-100"
              />
            </div>
          </div>

          {/* Builder Days */}
          <div className="space-y-4 pt-3">
            {builderDays.map((day, dIdx) => (
              <div
                key={day.id}
                className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <input
                    type="text"
                    value={day.dayName}
                    onChange={(e) => {
                      const days = [...builderDays];
                      days[dIdx].dayName = e.target.value;
                      setBuilderDays(days);
                    }}
                    className="font-bold text-zinc-100 bg-transparent border-b border-zinc-700 text-sm pb-1 w-full max-w-xs focus:outline-none focus:border-lime-400"
                  />
                  <button
                    onClick={() => {
                      const days = builderDays.filter((_, idx) => idx !== dIdx);
                      setBuilderDays(days);
                    }}
                    className="text-zinc-500 hover:text-rose-400 text-xs p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-2">
                  {day.exercises.map((ex, exIdx) => (
                    <div
                      key={ex.id}
                      className="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-lg grid grid-cols-1 sm:grid-cols-12 gap-2 items-center text-xs"
                    >
                      <div className="sm:col-span-4">
                        <input
                          type="text"
                          value={ex.name}
                          onChange={(e) => {
                            const days = [...builderDays];
                            days[dIdx].exercises[exIdx].name = e.target.value;
                            setBuilderDays(days);
                          }}
                          placeholder="Exercise Name"
                          className="w-full bg-transparent text-zinc-200 font-bold focus:outline-none"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          type="text"
                          value={ex.muscleGroup}
                          onChange={(e) => {
                            const days = [...builderDays];
                            days[dIdx].exercises[exIdx].muscleGroup = e.target.value;
                            setBuilderDays(days);
                          }}
                          placeholder="Muscle"
                          className="w-full bg-transparent text-zinc-400 text-[11px]"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          type="number"
                          value={ex.workingSets}
                          onChange={(e) => {
                            const days = [...builderDays];
                            days[dIdx].exercises[exIdx].workingSets = parseInt(e.target.value, 10) || 3;
                            setBuilderDays(days);
                          }}
                          className="w-14 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 font-mono text-[11px]"
                        />
                        <span className="text-[10px] text-zinc-500 ml-1">sets</span>
                      </div>
                      <div className="sm:col-span-3">
                        <input
                          type="text"
                          value={ex.repRange}
                          onChange={(e) => {
                            const days = [...builderDays];
                            days[dIdx].exercises[exIdx].repRange = e.target.value;
                            setBuilderDays(days);
                          }}
                          placeholder="8-12"
                          className="w-16 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 font-mono text-[11px]"
                        />
                        <span className="text-[10px] text-zinc-500 ml-1">reps</span>
                      </div>
                      <div className="sm:col-span-1 text-right">
                        <button
                          onClick={() => {
                            const days = [...builderDays];
                            days[dIdx].exercises = days[dIdx].exercises.filter((_, idx) => idx !== exIdx);
                            setBuilderDays(days);
                          }}
                          className="text-zinc-600 hover:text-rose-400 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => handleAddBuilderExercise(dIdx)}
                  className="text-xs text-lime-400 hover:underline flex items-center gap-1 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Exercise</span>
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-zinc-800/80">
            <button
              onClick={handleAddBuilderDay}
              className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 text-lime-400" />
              <span>Add Training Day</span>
            </button>

            <button
              onClick={handleSaveManualPlan}
              className="touch-press px-5 py-2 bg-lime-400 hover:bg-lime-300 text-black font-bold text-xs rounded-xl"
            >
              Save Routine to Library
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // DEFAULT VIEW: PLANS LIBRARY & UPLOAD BOX
  // ==========================================
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16">
      {/* Top Banner */}
      <div className="reshape-card p-5 lg:p-7 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--border-card)]">
          <div>
            <div className="flex items-center gap-2 text-volt-adaptive text-xs font-mono font-bold uppercase tracking-widest mb-1.5">
              <FileSpreadsheet className="w-4 h-4" />
              <span>Routines &amp; File Ingestion</span>
            </div>
            <h1 className="text-xl lg:text-3xl font-nrc font-black italic uppercase text-[var(--text-primary)] tracking-tight">
              Workout Plans &amp; Document Uploads
            </h1>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Upload PDF workouts, spreadsheets, screenshots, or build your custom training split.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSubView('manual_builder')}
              className="min-h-[44px] px-4 py-2.5 bg-[var(--bg-subtle)] hover:bg-[var(--chip-bg)] text-[var(--text-primary)] text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors border border-[var(--border-card)]"
            >
              <Plus className="w-3.5 h-3.5 text-volt-adaptive" />
              <span>Build New Plan</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] touch-press px-5 py-2.5 bg-[#CEFF00] hover:bg-[#b8e600] text-black font-extrabold text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-lg active:scale-[0.98]"
            >
              <Upload className="w-4 h-4 stroke-[2.5]" />
              <span>Upload Document</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,.json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Processing State */}
        {isProcessing && (
          <div className="mt-4 p-4 bg-[var(--bg-subtle)] border border-[#CEFF00]/40 rounded-xl flex items-center gap-3 text-xs text-volt-adaptive animate-pulse">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Analyzing file document and parsing workout routine exercises...</span>
          </div>
        )}

        {/* Upload Error Banner */}
        {uploadError && (
          <div className="mt-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-3 text-xs text-rose-500">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold">Extraction Notice:</span>
              <p>{uploadError}</p>
              <button
                onClick={() => setSubView('manual_builder')}
                className="underline text-[var(--text-primary)] font-medium hover:text-volt-adaptive transition-colors pt-1 block"
              >
                Launch Manual Plan Builder instead &rarr;
              </button>
            </div>
          </div>
        )}

        {/* File Dropzone Card */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="mt-6 border-2 border-dashed border-[var(--border-card)] hover:border-[#CEFF00]/60 bg-[var(--bg-subtle)] hover:bg-[var(--chip-bg)] rounded-2xl p-7 text-center cursor-pointer transition-all group"
        >
          <div className="w-12 h-12 rounded-2xl bg-[var(--bg-surface)] group-hover:bg-[#CEFF00]/15 border border-[var(--border-card)] group-hover:border-[#CEFF00]/40 flex items-center justify-center text-[var(--text-muted)] group-hover:text-volt-adaptive mx-auto mb-3 transition-colors">
            <Upload className="w-5 h-5" />
          </div>
          <h4 className="font-bold text-[var(--text-primary)] text-sm">
            Drag &amp; drop workout documents or tap to browse
          </h4>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Supports PDF workout routines, JPG/PNG screenshots, CSV spreadsheets, and TXT documents.
          </p>
        </div>
      </div>

      {/* PLANS LIBRARY */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-[var(--text-muted)]">
            Workout Plans Library ({plans.length})
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans.map((plan) => {
            const isActive = plan.id === activePlanId;
            const totalExercises = plan.days.reduce((acc, d) => acc + d.exercises.length, 0);

            return (
              <div
                key={plan.id}
                className={`reshape-card p-5 lg:p-6 space-y-4 transition-all ${
                  isActive
                    ? 'border-[#CEFF00] shadow-[0_0_24px_rgba(206,255,0,0.18)] ring-1 ring-[#CEFF00]'
                    : 'hover:border-[var(--border-card-hover)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-nrc font-black italic uppercase text-lg text-[var(--text-primary)] tracking-tight">{plan.name}</h4>
                      {plan.isStarter && (
                        <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase font-bold">
                          &bull; TEMPLATE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
                      {plan.description || `${plan.trainingSplit} split`}
                    </p>
                  </div>

                  {isActive && (
                    <span className="font-mono text-xs font-bold text-volt-adaptive uppercase tracking-wider shrink-0 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      <span>ACTIVE</span>
                    </span>
                  )}
                </div>

                <div className="text-xs font-mono text-[var(--text-muted)] flex items-center gap-2">
                  <span>{plan.days.length} Training Days</span>
                  <span>&middot;</span>
                  <span>{totalExercises} Total Exercises</span>
                </div>

                {/* Days preview unboxed list */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {plan.days.map((day) => (
                    <span
                      key={day.id}
                      className="text-[11px] font-mono text-[var(--text-secondary)] bg-[var(--bg-subtle)] border border-[var(--border-card)] px-2.5 py-1 rounded-lg"
                    >
                      {day.dayName}
                    </span>
                  ))}
                </div>

                {/* Plan card actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/[0.06] text-xs">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDuplicatePlan(plan)}
                      className="min-h-[36px] p-2 text-zinc-400 hover:text-white rounded-lg transition-colors"
                      title="Duplicate Plan"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeletePlan(plan.id)}
                      className="min-h-[36px] p-2 text-zinc-400 hover:text-rose-400 rounded-lg transition-colors"
                      title="Delete Plan"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (onNavigateToProgression) {
                          onNavigateToProgression(plan.id);
                        }
                      }}
                      className="min-h-[40px] px-3.5 py-1.5 bg-[#CEFF00]/10 hover:bg-[#CEFF00]/20 text-[#CEFF00] border border-[#CEFF00]/30 font-bold rounded-xl text-xs flex items-center gap-1 transition-colors"
                      title="Adjust Overload Analytics for this plan"
                    >
                      <TrendingUp className="w-3.5 h-3.5 text-[#CEFF00]" />
                      <span>Overload Rules &rarr;</span>
                    </button>

                    {!isActive && (
                      <button
                        onClick={() => handleActivatePlan(plan.id)}
                        className="min-h-[40px] px-3.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 hover:text-white font-bold rounded-xl transition-colors border border-white/10"
                      >
                        Set Active
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* UPLOADED DOCUMENTS AUDIT LOG */}
      {uploadedDocs.length > 0 && (
        <div className="bg-[#090c12] border border-white/[0.08] rounded-2xl p-5 shadow-2xl space-y-3">
          <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">
            Uploaded Files History ({uploadedDocs.length})
          </h3>
          <div className="divide-y divide-white/[0.04] font-mono text-xs">
            {uploadedDocs.map((doc) => (
              <div key={doc.id} className="py-3 flex items-center justify-between text-zinc-300">
                <div className="flex items-center gap-2.5 truncate max-w-sm">
                  <File className="w-4 h-4 text-zinc-500 shrink-0" />
                  <span className="font-bold text-white truncate">{doc.fileName}</span>
                </div>
                <div className="flex items-center gap-4 text-zinc-500 text-[11px]">
                  <span>{(doc.fileSize / 1024).toFixed(1)} KB</span>
                  <span className="capitalize">{doc.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
