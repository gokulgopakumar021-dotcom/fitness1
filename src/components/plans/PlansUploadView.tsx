import React, { useState, useRef } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  File,
  FileSpreadsheet,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload
} from 'lucide-react';
import {
  EquipmentType,
  PlannedExercise,
  ProgressionStrategy,
  TrainingPhase,
  UploadedDoc,
  UserProfile,
  WorkoutDay,
  WorkoutPlan,
  WorkoutSession
} from '../../types';
import { db } from '../../storage/db';
import { AiRoutineBuilderModal } from './AiRoutineBuilderModal';
import { PlanDaysEditor } from './PlanDaysEditor';
import { PlanDetail } from './PlanDetail';
import { summarizePlan, pluralize } from '../../utils/planPresentation';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  SectionHeading
} from '../ui';

export interface PlansUploadProps {
  profile: UserProfile;
  onPlanActivated: (planId: string) => void;
  onNavigateToProgression?: (planId: string) => void;
  onStartWorkout?: (session: WorkoutSession) => void;
}

type SubView = 'plans_list' | 'upload_file' | 'review_extracted' | 'manual_builder' | 'plan_detail';

const DOC_STATUS_TONE: Record<UploadedDoc['status'], 'neutral' | 'success' | 'danger'> = {
  pending: 'neutral',
  parsed: 'success',
  imported: 'success',
  failed: 'danger'
};

export const PlansUploadView: React.FC<PlansUploadProps> = ({
  profile,
  onPlanActivated,
  onNavigateToProgression,
  onStartWorkout
}) => {
  const [plans, setPlans] = useState<WorkoutPlan[]>(() => db.getPlans());
  const [activePlanId, setActivePlanId] = useState<string | null>(() => db.getActivePlanId());
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>(() => db.getUploadedDocs());
  const [isAiBuilderOpen, setIsAiBuilderOpen] = useState<boolean>(false);
  const [allSessions] = useState<WorkoutSession[]>(() => db.getSessions());

  // Active view: 'plans_list' | 'upload_file' | 'review_extracted' | 'manual_builder' | 'plan_detail'
  const [subView, setSubView] = useState<SubView>('plans_list');
  const [detailPlanId, setDetailPlanId] = useState<string | null>(null);

  // File upload state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Review & Correction state for extracted plan
  const [reviewPlan, setReviewPlan] = useState<WorkoutPlan | null>(null);
  const [, setCurrentDocId] = useState<string | null>(null);

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
  // Confirmation modal for deleting a plan (plan id awaiting confirmation)
  const [planToDelete, setPlanToDelete] = useState<string | null>(null);

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

  const confirmDeletePlan = () => {
    if (!planToDelete) return;
    handleDeletePlan(planToDelete);
    setPlanToDelete(null);
    if (subView === 'plan_detail') {
      setDetailPlanId(null);
      setSubView('plans_list');
    }
  };

  const openPlanDetail = (planId: string) => {
    setDetailPlanId(planId);
    setSubView('plan_detail');
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

  const deleteTarget = planToDelete ? plans.find((p) => p.id === planToDelete) : undefined;
  const deleteModal = (
    <Modal
      open={Boolean(deleteTarget)}
      onClose={() => setPlanToDelete(null)}
      title="Delete plan?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => setPlanToDelete(null)}>
            Cancel
          </Button>
          <Button variant="danger" icon={<Trash2 className="w-4 h-4" />} onClick={confirmDeletePlan}>
            Delete plan
          </Button>
        </>
      }
    >
      <p className="text-sm text-zinc-400 leading-relaxed">
        <strong className="text-white">{deleteTarget?.name}</strong> will be removed from your plan library.
        {deleteTarget && deleteTarget.id === activePlanId && ' It is your active plan, so you will have no active plan afterwards.'}
      </p>
    </Modal>
  );

  // ==========================================
  // SUBVIEW: PLAN DETAIL
  // ==========================================
  const detailPlan = subView === 'plan_detail' ? plans.find((p) => p.id === detailPlanId) : undefined;
  if (subView === 'plan_detail' && detailPlan) {
    return (
      <>
        <PlanDetail
          plan={detailPlan}
          isActive={detailPlan.id === activePlanId}
          onBack={() => setSubView('plans_list')}
          onActivate={() => handleActivatePlan(detailPlan.id)}
          onDuplicate={() => handleDuplicatePlan(detailPlan)}
          onDelete={() => setPlanToDelete(detailPlan.id)}
          onOpenOverloadRules={
            onNavigateToProgression ? () => onNavigateToProgression(detailPlan.id) : undefined
          }
        />
        {deleteModal}
      </>
    );
  }

  // ==========================================
  // SUBVIEW: REVIEW EXTRACTED PLAN
  // ==========================================
  if (subView === 'review_extracted' && reviewPlan) {
    const reviewSummary = summarizePlan(reviewPlan);
    return (
      <div className="space-y-6 max-w-4xl mx-auto pb-16">
        <PageHeader
          eyebrow="Verification & correction"
          title="Review extracted plan"
          description="Verify exercises, rep ranges, and training days before importing to your library."
          className="mb-0"
          actions={
            <Button variant="secondary" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => setSubView('plans_list')}>
              Cancel review
            </Button>
          }
        />

        <Card as="section" aria-label="Plan details" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Plan name"
              value={reviewPlan.name}
              onChange={(e) => setReviewPlan({ ...reviewPlan, name: e.target.value })}
              className="font-semibold"
            />
            <Input
              label="Training split"
              value={reviewPlan.trainingSplit}
              onChange={(e) => setReviewPlan({ ...reviewPlan, trainingSplit: e.target.value })}
            />
          </div>

          <div className="rounded-control border border-line p-3 sm:p-4 space-y-3">
            <p className="text-xs font-semibold text-white flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-accent" aria-hidden />
              Overload settings
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Overload progression strategy"
                value={reviewPlan.defaultStrategy || 'double_progression'}
                onChange={(e) => setReviewPlan({ ...reviewPlan, defaultStrategy: e.target.value as ProgressionStrategy })}
              >
                <option value="double_progression">Standard Double Progression (All Sets Top of Range)</option>
                <option value="top_set_only">Top-Set Only Progression</option>
                <option value="consecutive_sessions">Dual-Session Consolidation</option>
                <option value="linear_load">Linear Micro-Load (+2.5kg Weekly)</option>
              </Select>
              <Select
                label="Initial training phase"
                value={reviewPlan.progressionPhase || 'hypertrophy'}
                onChange={(e) => setReviewPlan({ ...reviewPlan, progressionPhase: e.target.value as TrainingPhase })}
              >
                <option value="hypertrophy">Hypertrophy (Progressive Overload)</option>
                <option value="strength">Strength (Lower Reps, Heavy Compound)</option>
                <option value="adaptation">Adaptation (Ramp-up / Form Focus)</option>
                <option value="deload">Deload (-25% Load Reduction)</option>
              </Select>
            </div>
          </div>
        </Card>

        <PlanDaysEditor days={reviewPlan.days} onChange={(days) => setReviewPlan({ ...reviewPlan, days })} />

        <Card as="section" aria-label="Import options" className="space-y-4">
          <p className="text-sm text-zinc-400 tabular">
            Total: {pluralize(reviewSummary.dayCount, 'day')} · {pluralize(reviewSummary.exerciseCount, 'exercise')}
          </p>
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:justify-end gap-2">
            <Button variant="secondary" onClick={handleImportAsNewPlan}>
              Import as library plan
            </Button>
            <Button variant="secondary" icon={<TrendingUp className="w-4 h-4 text-accent" />} onClick={handleImportAndTuneOverload}>
              Import &amp; tune overload analytics
            </Button>
            <Button onClick={() => setShowReplaceModal(true)}>Import &amp; set as active plan</Button>
          </div>
        </Card>

        {/* Confirmation Modal to Replace Active Plan */}
        <Modal
          open={showReplaceModal}
          onClose={() => setShowReplaceModal(false)}
          title="Replace active plan?"
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowReplaceModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleImportAndReplaceActive}>Confirm &amp; activate</Button>
            </>
          }
        >
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" aria-hidden />
            <p className="text-sm text-zinc-400 leading-relaxed">
              This will set <strong className="text-white">{reviewPlan.name}</strong> as your active routine for today&apos;s
              workout tracker. Your other saved plans remain preserved in your library.
            </p>
          </div>
        </Modal>
      </div>
    );
  }

  // ==========================================
  // SUBVIEW: MANUAL PLAN BUILDER
  // ==========================================
  if (subView === 'manual_builder') {
    return (
      <div className="space-y-6 max-w-4xl mx-auto pb-16">
        <PageHeader
          title="Build a plan"
          description="Construct your training split, prescribe working sets, rep ranges, and rest intervals."
          className="mb-0"
          actions={
            <Button variant="secondary" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => setSubView('plans_list')}>
              Back to plans
            </Button>
          }
        />

        <Card as="section" aria-label="Plan details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Plan name"
              value={builderPlanName}
              onChange={(e) => setBuilderPlanName(e.target.value)}
              className="font-semibold"
            />
            <Input label="Training split" value={builderSplit} onChange={(e) => setBuilderSplit(e.target.value)} />
          </div>
        </Card>

        <PlanDaysEditor days={builderDays} onChange={setBuilderDays} allowAddDay />

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="secondary" onClick={() => setSubView('plans_list')}>
            Cancel
          </Button>
          <Button onClick={handleSaveManualPlan}>Save routine to library</Button>
        </div>
      </div>
    );
  }

  // ==========================================
  // DEFAULT VIEW: PLANS LIBRARY & UPLOAD BOX
  // ==========================================
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16">
      <PageHeader
        title="Workout plans"
        description="Manage your training splits, upload workout files, or build a plan of your own."
        className="mb-0"
        actions={
          <>
            <Button variant="secondary" icon={<Sparkles className="w-4 h-4" />} onClick={() => setIsAiBuilderOpen(true)}>
              AI builder
            </Button>
            <Button variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={() => setSubView('manual_builder')}>
              Build plan
            </Button>
            <Button icon={<Upload className="w-4 h-4" />} onClick={() => fileInputRef.current?.click()}>
              Upload
            </Button>
          </>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,.json"
        onChange={handleFileUpload}
        className="hidden"
        aria-label="Upload a workout document"
      />

      {/* Processing State */}
      {isProcessing && (
        <Card pad="sm">
          <LoadingState label="Analyzing file document and parsing workout routine exercises…" className="py-3" />
        </Card>
      )}

      {/* Upload Error Banner */}
      {uploadError && (
        <ErrorState
          title="Extraction notice"
          description={uploadError}
          action={
            <Button variant="secondary" size="sm" onClick={() => setSubView('manual_builder')} icon={<ArrowRight className="w-4 h-4" />}>
              Build manually instead
            </Button>
          }
        />
      )}

      {/* AI Routine Builder */}
      <Card tone="accent" as="section" aria-label="AI routine builder" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-control bg-accent text-accent-ink flex items-center justify-center shrink-0" aria-hidden>
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-white">AI muscle heatmap &amp; gear-adaptive routine builder</h2>
              <Badge tone="accent">Heatmap adaptive</Badge>
            </div>
            <p className="text-xs text-zinc-400 mt-1 max-w-xl">
              Automatically scans your logged 7-day muscle fatigue heatmap to target fresh muscle groups, protect recovering
              stabilizers, and filter exercises exclusively to your available equipment inventory.
            </p>
          </div>
        </div>
        <Button icon={<ArrowRight className="w-4 h-4" />} onClick={() => setIsAiBuilderOpen(true)} className="sm:shrink-0">
          Launch AI builder
        </Button>
      </Card>

      {/* PLANS LIBRARY */}
      <section aria-label="Plan library">
        <SectionHeading title="Your plans" description={pluralize(plans.length, 'plan')} />

        {plans.length === 0 ? (
          <EmptyState
            icon={<FileSpreadsheet className="w-5 h-5" />}
            title="No workout plans yet"
            description="Upload a workout file, use the AI builder, or build a plan by hand."
            action={
              <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setSubView('manual_builder')}>
                Build plan
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {plans.map((plan) => {
              const isActive = plan.id === activePlanId;
              const summary = summarizePlan(plan);

              return (
                <Card key={plan.id} as="article" tone={isActive ? 'accent' : 'default'} className="flex flex-col gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-semibold text-white tracking-tight break-words min-w-0">{plan.name}</h3>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isActive && (
                          <Badge tone="accent" icon={<Check className="w-3 h-3" aria-hidden />}>
                            Active
                          </Badge>
                        )}
                        {plan.isStarter && <Badge>Template</Badge>}
                      </div>
                    </div>
                    <p className="text-xs text-zinc-400 line-clamp-2">{plan.description || `${plan.trainingSplit} split`}</p>
                  </div>

                  <p className="text-xs text-zinc-300 tabular">
                    {pluralize(summary.dayCount, 'training day')} · {pluralize(summary.exerciseCount, 'exercise')} ·{' '}
                    {pluralize(summary.setCount, 'set')}
                  </p>

                  {plan.days.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5" aria-label="Training days">
                      {plan.days.map((day) => (
                        <li key={day.id}>
                          <Badge>{day.dayName}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-auto pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        iconOnly
                        icon={<Copy className="w-4 h-4" />}
                        aria-label={`Duplicate ${plan.name}`}
                        title="Duplicate plan"
                        onClick={() => handleDuplicatePlan(plan)}
                      />
                      <Button
                        variant="ghost"
                        iconOnly
                        icon={<Trash2 className="w-4 h-4" />}
                        aria-label={`Delete ${plan.name}`}
                        title="Delete plan"
                        onClick={() => setPlanToDelete(plan.id)}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {onNavigateToProgression && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<TrendingUp className="w-4 h-4" />}
                          title="Adjust overload analytics for this plan"
                          onClick={() => onNavigateToProgression(plan.id)}
                        >
                          Overload rules
                        </Button>
                      )}
                      {!isActive && (
                        <Button variant="secondary" size="sm" onClick={() => handleActivatePlan(plan.id)}>
                          Set active
                        </Button>
                      )}
                      <Button size="sm" variant={isActive ? 'primary' : 'secondary'} onClick={() => openPlanDetail(plan.id)}>
                        View
                        <ChevronRight className="w-4 h-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Upload from file */}
      <section aria-label="Upload a workout file">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full rounded-card border border-dashed border-line-strong hover:border-accent/60 bg-transparent hover:bg-surface p-6 text-center transition-colors touch-press"
        >
          <span className="w-11 h-11 rounded-control bg-surface-2 border border-line flex items-center justify-center text-zinc-400 mx-auto mb-3" aria-hidden>
            <Upload className="w-5 h-5" />
          </span>
          <span className="block text-sm font-semibold text-white">Tap to choose a workout file</span>
          <span className="block text-xs text-zinc-400 mt-1">
            Supports PDF workout routines, JPG/PNG screenshots, CSV spreadsheets, JSON and TXT documents.
          </span>
        </button>
      </section>

      {/* UPLOADED DOCUMENTS AUDIT LOG */}
      {uploadedDocs.length > 0 && (
        <Card as="section" aria-label="Uploaded files history">
          <SectionHeading title="Uploaded files" description={pluralize(uploadedDocs.length, 'file')} />
          <ul className="divide-y divide-line">
            {uploadedDocs.map((doc) => (
              <li key={doc.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <File className="w-4 h-4 text-zinc-500 shrink-0" aria-hidden />
                  <span className="text-sm font-medium text-white truncate">{doc.fileName}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="hidden sm:inline text-xs text-zinc-500 tabular">{(doc.fileSize / 1024).toFixed(1)} KB</span>
                  <Badge tone={DOC_STATUS_TONE[doc.status]} className="capitalize">
                    {doc.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {deleteModal}

      {/* AI Muscle Heatmap & Gear-Adaptive Routine Builder Modal */}
      <AiRoutineBuilderModal
        isOpen={isAiBuilderOpen}
        onClose={() => setIsAiBuilderOpen(false)}
        profile={profile}
        sessions={allSessions}
        onStartWorkout={(session) => {
          setIsAiBuilderOpen(false);
          if (onStartWorkout) {
            onStartWorkout(session);
          }
        }}
        onPlanSaved={(newPlan) => {
          setPlans(db.getPlans());
          setActivePlanId(newPlan.id);
          onPlanActivated(newPlan.id);
        }}
      />
    </div>
  );
};
