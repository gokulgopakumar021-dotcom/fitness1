import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowLeft,
  Play,
  Lock,
  Grid,
  Scan,
  Activity,
  Check,
  Eye,
  EyeOff,
  Zap,
  RefreshCw,
  Compass,
  Maximize2,
  Target,
} from 'lucide-react';
import {
  ExerciseDefinition,
  MirrorPoint,
  CalibrationEvaluation,
  POSE_LANDMARKS,
} from '../../types/workoutMirror';
import { CameraController } from '../../services/camera';
import { mirrorPoseService } from '../../services/workoutMirror/mirrorPoseService';
import { evaluateJointCalibration } from '../../services/workoutMirror/jointGeometry';
import { globalVoiceCoach } from '../../services/workoutMirror/voiceCoach';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { cn } from '../ui/cn';

export interface PreWorkoutCalibrationProps {
  exercise: ExerciseDefinition;
  cameraController: CameraController;
  onReadyToStart: (facing: 'user' | 'environment') => void;
  onCancel: () => void;
}

type CalibrationTab = 'joints' | 'alignment' | 'test';

export const PreWorkoutCalibration: React.FC<PreWorkoutCalibrationProps> = ({
  exercise,
  cameraController,
  onReadyToStart,
  onCancel,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [cameraState, setCameraState] = useState(() => cameraController.getState());
  const [modelReady, setModelReady] = useState(() => mirrorPoseService.isReady());
  const [modelLoading, setModelLoading] = useState(false);

  // Calibration and grid UI state
  const [activeTab, setActiveTab] = useState<CalibrationTab>('joints');
  const [showGrid, setShowGrid] = useState(true);
  const [showVisualMarkers, setShowVisualMarkers] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);

  // Detection and calibration analysis
  const [calibrationData, setCalibrationData] = useState<CalibrationEvaluation>(() =>
    evaluateJointCalibration(null, exercise.id)
  );
  const [isCentered, setIsCentered] = useState(false);
  const [centeringOffset, setCenteringOffset] = useState<'centered' | 'left' | 'right'>('centered');
  const [calibrationHoldProgress, setCalibrationHoldProgress] = useState(0);
  const [isCalibrationLocked, setIsCalibrationLocked] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const animFrameRef = useRef<number | null>(null);
  const lastInferenceRef = useRef<number>(0);
  const lastUiUpdateRef = useRef<number>(0);
  const holdStartTimeRef = useRef<number | null>(null);
  const lockedAnnouncedRef = useRef(false);

  // Camera subscription
  useEffect(() => {
    const unsub = cameraController.subscribe(() => {
      setCameraState(cameraController.getState());
    });
    return unsub;
  }, [cameraController]);

  // Start camera if unrequested
  useEffect(() => {
    if (cameraState.status === 'not_requested') {
      cameraController.start({ facingMode: 'user' });
    }
  }, [cameraState.status, cameraController]);

  // Bind video stream
  useEffect(() => {
    if (videoRef.current && cameraState.stream) {
      videoRef.current.srcObject = cameraState.stream;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraState.stream]);

  // Initialize Pose model
  useEffect(() => {
    let mounted = true;
    if (!mirrorPoseService.isReady()) {
      setModelLoading(true);
      mirrorPoseService
        .init()
        .then(() => {
          if (mounted) {
            setModelReady(true);
            setModelLoading(false);
          }
        })
        .catch(() => {
          if (mounted) {
            setModelLoading(false);
          }
        });
    }
    return () => {
      mounted = false;
    };
  }, []);

  // Frame processing loop with real-time pose inference, grid checks, and joint verification
  useEffect(() => {
    if (cameraState.status !== 'granted' || !modelReady) return;

    let isRunning = true;

    const tick = (now: number) => {
      if (!isRunning) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && video.readyState >= 2) {
        if (now - lastInferenceRef.current >= 32) {
          lastInferenceRef.current = now;
          const detected = mirrorPoseService.detectForVideo(video, now);

          // Update positioning diagnostics (~5 times per second)
          if (now - lastUiUpdateRef.current >= 180) {
            lastUiUpdateRef.current = now;
            const evalResult = evaluateJointCalibration(detected, exercise.id);
            setCalibrationData(evalResult);

            // Compute centering in grid
            let centered = false;
            let offset: 'centered' | 'left' | 'right' = 'centered';

            if (detected && detected.length >= 25) {
              const leftHip = detected[POSE_LANDMARKS.LEFT_HIP];
              const rightHip = detected[POSE_LANDMARKS.RIGHT_HIP];
              const leftShoulder = detected[POSE_LANDMARKS.LEFT_SHOULDER];
              const rightShoulder = detected[POSE_LANDMARKS.RIGHT_SHOULDER];

              if (leftHip && rightHip && leftShoulder && rightShoulder) {
                // In mirrored mode, coordinates are flipped
                const midX = (leftHip.x + rightHip.x + leftShoulder.x + rightShoulder.x) / 4;
                if (midX < 0.38) {
                  offset = cameraState.facing === 'user' ? 'right' : 'left';
                  centered = false;
                } else if (midX > 0.62) {
                  offset = cameraState.facing === 'user' ? 'left' : 'right';
                  centered = false;
                } else {
                  offset = 'centered';
                  centered = true;
                }
              }
            }

            setIsCentered(centered);
            setCenteringOffset(offset);

            // Strictly verify: user is correctly positioned AND all required joints are detected
            const isPositionCorrect =
              evalResult.distanceStatus === 'optimal' &&
              centered &&
              evalResult.overallConfidence >= 60;

            const areRequiredJointsDetected =
              evalResult.totalRequired > 0 &&
              evalResult.passedRequired === evalResult.totalRequired;

            const isCalibrationReady = isPositionCorrect && areRequiredJointsDetected;

            // Calibration lock-in hold timer (1.5 seconds steady position)
            if (isCalibrationReady && !isCalibrationLocked) {
              if (holdStartTimeRef.current === null) {
                holdStartTimeRef.current = now;
              }
              const elapsed = now - holdStartTimeRef.current;
              const progress = Math.min(100, Math.round((elapsed / 1500) * 100));
              setCalibrationHoldProgress(progress);

              if (progress >= 100 && !lockedAnnouncedRef.current) {
                setIsCalibrationLocked(true);
                lockedAnnouncedRef.current = true;
                globalVoiceCoach.speakMilestone(
                  'Position locked. All key joints verified. You may begin your workout.'
                );
              }
            } else if (!isCalibrationLocked) {
              holdStartTimeRef.current = null;
              setCalibrationHoldProgress(0);
            }
          }

          // Draw skeleton and visual joint markers on canvas overlay
          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              canvas.width = video.videoWidth || 640;
              canvas.height = video.videoHeight || 480;

              if (detected && showSkeleton) {
                const theme = isCalibrationLocked
                  ? 'volt'
                  : calibrationData.passedRequired === calibrationData.totalRequired
                  ? 'volt'
                  : 'cyan';

                mirrorPoseService.drawSkeleton(ctx, detected, canvas.width, canvas.height, {
                  colorTheme: theme,
                  mirrorHorizontally: cameraState.facing === 'user',
                });

                // Draw extra calibration target rings over required joints if enabled
                if (showVisualMarkers) {
                  ctx.save();
                  const isMirrored = cameraState.facing === 'user';

                  const drawJointTarget = (idx: number, isRequired: boolean) => {
                    const pt = detected[idx];
                    if (!pt || (pt.visibility ?? 0) < 0.3) return;

                    const rawX = isMirrored ? 1 - pt.x : pt.x;
                    const px = rawX * canvas.width;
                    const py = pt.y * canvas.height;

                    ctx.beginPath();
                    ctx.arc(px, py, isRequired ? 12 : 8, 0, Math.PI * 2);
                    ctx.strokeStyle = isCalibrationLocked
                      ? 'rgba(204, 255, 0, 0.9)'
                      : (pt.visibility ?? 0) >= 0.65
                      ? 'rgba(16, 185, 129, 0.9)'
                      : 'rgba(245, 158, 11, 0.9)';
                    ctx.lineWidth = isRequired ? 2.5 : 1.5;
                    ctx.stroke();

                    // Inner pulse dot
                    ctx.beginPath();
                    ctx.arc(px, py, 3, 0, Math.PI * 2);
                    ctx.fillStyle = isCalibrationLocked ? '#CCFF00' : '#FFFFFF';
                    ctx.fill();
                  };

                  // Draw markers on key anatomical anchors
                  drawJointTarget(POSE_LANDMARKS.NOSE, true);
                  drawJointTarget(POSE_LANDMARKS.LEFT_SHOULDER, true);
                  drawJointTarget(POSE_LANDMARKS.RIGHT_SHOULDER, true);
                  drawJointTarget(POSE_LANDMARKS.LEFT_HIP, true);
                  drawJointTarget(POSE_LANDMARKS.RIGHT_HIP, true);
                  drawJointTarget(POSE_LANDMARKS.LEFT_KNEE, true);
                  drawJointTarget(POSE_LANDMARKS.RIGHT_KNEE, true);
                  drawJointTarget(POSE_LANDMARKS.LEFT_ANKLE, true);
                  drawJointTarget(POSE_LANDMARKS.RIGHT_ANKLE, true);

                  ctx.restore();
                }
              } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
              }
            }
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      isRunning = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [
    cameraState.status,
    cameraState.facing,
    modelReady,
    exercise.id,
    isCalibrationLocked,
    showSkeleton,
    showVisualMarkers,
    calibrationData.passedRequired,
    calibrationData.totalRequired,
  ]);

  // Recalibrate handler
  const handleRecalibrate = () => {
    setIsCalibrationLocked(false);
    lockedAnnouncedRef.current = false;
    holdStartTimeRef.current = null;
    setCalibrationHoldProgress(0);
  };

  // Launch countdown into workout
  const handleStartWorkout = () => {
    if (!isCalibrationLocked) return;
    setCountdown(3);
  };

  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown((prev) => (prev !== null ? prev - 1 : null));
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      onReadyToStart(cameraState.facing === 'environment' ? 'environment' : 'user');
    }
  }, [countdown, onReadyToStart, cameraState.facing]);

  // Stance classification
  const isFloorExercise = exercise.id === 'pushup' || exercise.id === 'plank';
  const isLungeExercise = exercise.id === 'forward_lunge' || exercise.id === 'reverse_lunge';

  // Overall gating condition: user must be correctly positioned and joints detected
  const isPositionValid =
    calibrationData.distanceStatus === 'optimal' && isCentered;
  const areRequiredJointsValid =
    calibrationData.totalRequired > 0 &&
    calibrationData.passedRequired === calibrationData.totalRequired;
  const canStartWorkout = isCalibrationLocked;

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-10">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Exercises</span>
        </button>

        <div className="flex items-center gap-2">
          <Badge tone="accent">{exercise.name}</Badge>
          <Badge tone={isCalibrationLocked ? 'success' : isPositionValid && areRequiredJointsValid ? 'warning' : 'neutral'}>
            {isCalibrationLocked
              ? 'Calibration Locked ✓'
              : isPositionValid && areRequiredJointsValid
              ? 'Holding Position...'
              : 'Position Alignment Required'}
          </Badge>
        </div>
      </div>

      {/* Main Camera Viewfinder with Biomechanical Grid Overlay & Visual Markers */}
      <div
        className={cn(
          'relative aspect-[3/4] sm:aspect-[4/3] max-h-[64vh] w-full bg-zinc-950 rounded-2xl overflow-hidden border shadow-2xl flex items-center justify-center transition-all duration-300',
          isCalibrationLocked
            ? 'border-emerald-500/80 shadow-[0_0_35px_rgba(16,185,129,0.3)]'
            : calibrationHoldProgress > 0
            ? 'border-volt-adaptive/70 shadow-[0_0_25px_rgba(204,255,0,0.2)]'
            : 'border-line'
        )}
      >
        {/* Live Video Feed */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={cn(
            'absolute inset-0 w-full h-full object-cover',
            cameraState.facing === 'user' && '-scale-x-100'
          )}
        />

        {/* Real-time Skeleton Canvas Overlay */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none z-10"
        />

        {/* Biomechanical Precision Alignment Grid Overlay */}
        {showGrid && (
          <div className="absolute inset-0 pointer-events-none z-10 transition-opacity">
            {/* 3x3 Rule-of-Thirds Grid Lines */}
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 border border-white/10">
              <div className="border-r border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-b border-white/10" />
              <div className="border-r border-white/10" />
              <div className="border-r border-white/10" />
              <div />
            </div>

            {/* Precision Grid Crosshair Ticks at Intersections */}
            <div className="absolute top-1/3 left-1/3 -translate-x-1/2 -translate-y-1/2 text-cyan-400/50 text-[10px]">
              +
            </div>
            <div className="absolute top-1/3 left-2/3 -translate-x-1/2 -translate-y-1/2 text-cyan-400/50 text-[10px]">
              +
            </div>
            <div className="absolute top-2/3 left-1/3 -translate-x-1/2 -translate-y-1/2 text-cyan-400/50 text-[10px]">
              +
            </div>
            <div className="absolute top-2/3 left-2/3 -translate-x-1/2 -translate-y-1/2 text-cyan-400/50 text-[10px]">
              +
            </div>

            {/* Vertical Plumb Line for Centering & Symmetry */}
            <div
              className={cn(
                'absolute inset-y-4 left-1/2 -translate-x-1/2 w-px border-l transition-colors duration-200',
                isCentered
                  ? 'border-emerald-400/60 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                  : 'border-dashed border-amber-400/40'
              )}
            />

            {/* Horizontal Alignment Guides */}
            <div className="absolute top-[18%] inset-x-8 border-b border-dashed border-cyan-400/30 flex items-center justify-between text-[9px] font-mono text-cyan-300/60 px-2">
              <span>{isFloorExercise ? 'SHOULDER PLANE' : 'HEAD PLANE'}</span>
              <span>Y: 18%</span>
            </div>

            <div className="absolute top-[52%] inset-x-8 border-b border-dashed border-cyan-400/30 flex items-center justify-between text-[9px] font-mono text-cyan-300/60 px-2">
              <span>HIP HINGE PLANE</span>
              <span>Y: 52%</span>
            </div>

            <div className="absolute bottom-[14%] inset-x-8 border-b border-dashed border-cyan-400/30 flex items-center justify-between text-[9px] font-mono text-cyan-300/60 px-2">
              <span>FOOT CONTACT PLANE</span>
              <span>Y: 86%</span>
            </div>

            {/* Framing Corner Brackets */}
            <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-volt-adaptive/70 rounded-tl-lg" />
            <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-volt-adaptive/70 rounded-tr-lg" />
            <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-volt-adaptive/70 rounded-bl-lg" />
            <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-volt-adaptive/70 rounded-br-lg" />
          </div>
        )}

        {/* Visual Target Reticles for Calibration Stance */}
        {showVisualMarkers && (
          <div className="absolute inset-0 pointer-events-none z-10 flex flex-col items-center justify-between p-6">
            {/* Top Target Marker (Head/Shoulder Box) */}
            <div
              className={cn(
                'w-28 sm:w-36 h-24 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center transition-colors',
                calibrationData.joints.find((j) => j.id === 'head')?.status === 'verified'
                  ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/30 text-white/50'
              )}
            >
              <Target className="w-5 h-5 mb-1 animate-pulse" />
              <span className="text-[10px] font-mono uppercase tracking-wider">
                {isFloorExercise ? 'Shoulders' : 'Head Target'}
              </span>
            </div>

            {/* Bottom Target Markers (Foot Contact Zones) */}
            <div className="w-full flex justify-around px-8 sm:px-16">
              <div
                className={cn(
                  'w-20 sm:w-24 h-12 rounded-xl border border-dashed flex items-center justify-center transition-colors',
                  calibrationData.joints.find((j) => j.id === 'feet')?.status === 'verified'
                    ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-300'
                    : 'border-white/30 text-white/50'
                )}
              >
                <span className="text-[9px] font-mono uppercase">
                  {isLungeExercise ? 'Lead Foot' : 'Left Foot'}
                </span>
              </div>

              <div
                className={cn(
                  'w-20 sm:w-24 h-12 rounded-xl border border-dashed flex items-center justify-center transition-colors',
                  calibrationData.joints.find((j) => j.id === 'feet')?.status === 'verified'
                    ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-300'
                    : 'border-white/30 text-white/50'
                )}
              >
                <span className="text-[9px] font-mono uppercase">
                  {isLungeExercise ? 'Rear Foot' : 'Right Foot'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Toolbar Controls Overlay */}
        <div className="absolute top-4 right-4 flex items-center gap-2 z-20">
          <button
            onClick={() => setShowGrid((prev) => !prev)}
            className={cn(
              'p-2.5 rounded-full backdrop-blur-md transition-colors border',
              showGrid
                ? 'bg-accent/20 border-accent text-accent'
                : 'bg-black/60 border-white/20 text-zinc-300 hover:bg-black/80'
            )}
            title="Toggle Alignment Grid"
            aria-label="Toggle Alignment Grid"
          >
            <Grid className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowVisualMarkers((prev) => !prev)}
            className={cn(
              'p-2.5 rounded-full backdrop-blur-md transition-colors border',
              showVisualMarkers
                ? 'bg-accent/20 border-accent text-accent'
                : 'bg-black/60 border-white/20 text-zinc-300 hover:bg-black/80'
            )}
            title="Toggle Target Markers"
            aria-label="Toggle Target Markers"
          >
            <Target className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowSkeleton((prev) => !prev)}
            className={cn(
              'p-2.5 rounded-full backdrop-blur-md transition-colors border',
              showSkeleton
                ? 'bg-accent/20 border-accent text-accent'
                : 'bg-black/60 border-white/20 text-zinc-300 hover:bg-black/80'
            )}
            title="Toggle Skeleton Nodes"
            aria-label="Toggle Skeleton Nodes"
          >
            {showSkeleton ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>

          {cameraState.canSwitch && (
            <button
              onClick={() => cameraController.switchCamera()}
              className="p-2.5 rounded-full bg-black/60 backdrop-blur-md text-white hover:bg-black/80 transition-colors border border-white/20"
              title="Switch Camera (front/back)"
              aria-label="Switch Camera"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Status and Guidance Pill at Bottom of Viewfinder */}
        <div className="absolute bottom-4 inset-x-4 flex flex-col items-center gap-2 z-20">
          {/* Real-time Hold Progress Bar */}
          {!isCalibrationLocked && calibrationHoldProgress > 0 && (
            <div className="w-full max-w-sm bg-black/85 backdrop-blur-md p-2.5 rounded-xl border border-volt-adaptive/50 flex flex-col gap-1.5 shadow-2xl animate-in fade-in">
              <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-200">
                <span className="flex items-center gap-1.5 text-volt-adaptive">
                  <Activity className="w-3.5 h-3.5 animate-pulse" />
                  Calibrating Position in Grid... Hold Still
                </span>
                <span className="font-mono">{calibrationHoldProgress}%</span>
              </div>
              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-volt-adaptive transition-all duration-100"
                  style={{ width: `${calibrationHoldProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Positioning & Detection Feedback Pill */}
          <div
            className={cn(
              'px-4 py-2.5 rounded-xl backdrop-blur-md text-xs font-semibold flex items-center gap-2.5 shadow-xl border max-w-lg text-center transition-colors',
              isCalibrationLocked
                ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-200'
                : isPositionValid && areRequiredJointsValid
                ? 'bg-volt-950/90 border-volt-adaptive/60 text-white'
                : 'bg-zinc-900/95 border-amber-500/50 text-amber-200'
            )}
          >
            {isCalibrationLocked ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : isPositionValid && areRequiredJointsValid ? (
              <Sparkles className="w-4 h-4 text-volt-adaptive shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            )}

            <span>
              {isCalibrationLocked
                ? `Alignment verified! All ${calibrationData.totalRequired} required joints detected in grid.`
                : !isCentered
                ? centeringOffset === 'left'
                  ? 'Shift right toward the center plumb line.'
                  : 'Shift left toward the center plumb line.'
                : !areRequiredJointsValid
                ? `Joints needed: ${calibrationData.joints
                    .filter((j) => j.isRequired && j.status !== 'verified')
                    .map((j) => j.name)
                    .join(', ')}`
                : calibrationData.advice}
            </span>
          </div>
        </div>

        {/* Countdown Overlay */}
        {countdown !== null && (
          <div className="absolute inset-0 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center z-40 animate-in fade-in duration-200">
            <div className="text-8xl sm:text-9xl font-black text-volt-adaptive drop-shadow-[0_0_35px_rgba(204,255,0,0.8)]">
              {countdown > 0 ? countdown : 'GO!'}
            </div>
            <p className="text-sm font-semibold text-zinc-200 mt-4">
              Get ready for set 1: {exercise.name}
            </p>
          </div>
        )}
      </div>

      {/* Interactive Calibration Console & Joint Checklist */}
      <Card className="p-4 sm:p-5 border-line space-y-4">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex items-center gap-2.5">
            <Scan className="w-5 h-5 text-volt-adaptive" />
            <div>
              <h3 className="text-sm font-bold text-white">Pre-Workout Calibration & Grid Alignment</h3>
              <p className="text-xs text-zinc-400">
                Position yourself in the grid and verify all key joints before starting
              </p>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex items-center p-1 bg-zinc-900 rounded-xl border border-line text-xs font-semibold">
            <button
              onClick={() => setActiveTab('joints')}
              className={cn(
                'px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5',
                activeTab === 'joints'
                  ? 'bg-zinc-800 text-white shadow'
                  : 'text-zinc-400 hover:text-white'
              )}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Joint Checklist</span>
              <span
                className={cn(
                  'px-1.5 py-0.2 rounded-full text-[10px] font-mono',
                  areRequiredJointsValid
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-amber-500/20 text-amber-300'
                )}
              >
                {calibrationData.passedRequired}/{calibrationData.totalRequired}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('alignment')}
              className={cn(
                'px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5',
                activeTab === 'alignment'
                  ? 'bg-zinc-800 text-white shadow'
                  : 'text-zinc-400 hover:text-white'
              )}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>Placement Guide</span>
            </button>

            <button
              onClick={() => setActiveTab('test')}
              className={cn(
                'px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5',
                activeTab === 'test'
                  ? 'bg-zinc-800 text-white shadow'
                  : 'text-zinc-400 hover:text-white'
              )}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Motion Preview</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Joint Verification Checklist */}
        {activeTab === 'joints' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Required key landmarks for {exercise.name}:</span>
              <span className="font-mono text-zinc-300">
                Tracking Confidence: <strong className="text-white">{calibrationData.overallConfidence}%</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {calibrationData.joints.map((joint) => {
                const isPassed = joint.status === 'verified';
                const isFair = joint.status === 'fair';

                return (
                  <div
                    key={joint.id}
                    className={cn(
                      'p-2.5 rounded-xl border flex flex-col justify-between gap-2 transition-all',
                      isPassed
                        ? 'bg-emerald-950/20 border-emerald-500/40'
                        : isFair
                        ? 'bg-amber-950/20 border-amber-500/40'
                        : 'bg-zinc-900/60 border-zinc-800 opacity-70'
                    )}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex items-center gap-2">
                        {isPassed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : isFair ? (
                          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border border-zinc-600 shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-zinc-100">{joint.name}</span>
                      </div>

                      {joint.isRequired && (
                        <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-volt-adaptive/10 text-volt-adaptive border border-volt-adaptive/25">
                          Required
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span className="truncate pr-1 text-[10px] text-zinc-400">{joint.detail}</span>
                      <span
                        className={cn(
                          'font-mono text-[10px] font-bold shrink-0',
                          isPassed
                            ? 'text-emerald-400'
                            : isFair
                            ? 'text-amber-400'
                            : 'text-zinc-400'
                        )}
                      >
                        {joint.confidence}%
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full transition-all duration-200',
                          isPassed
                            ? 'bg-emerald-400'
                            : isFair
                            ? 'bg-amber-400'
                            : 'bg-zinc-700'
                        )}
                        style={{ width: `${joint.confidence}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: Placement & Grid Guidelines */}
        {activeTab === 'alignment' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-xl bg-zinc-900/80 border border-line space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                <Compass className="w-4 h-4 text-accent" />
                <span>Recommended Camera Angle</span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                {exercise.cameraAngleExplanation}
              </p>
              <div className="pt-1 flex flex-wrap gap-2 text-[11px]">
                <Badge tone="accent">Angle: {exercise.recommendedCameraAngle.replace('_', ' ')}</Badge>
                <Badge tone="neutral">Center plumb line active</Badge>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-900/80 border border-line space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                <Maximize2 className="w-4 h-4 text-accent" />
                <span>Grid Alignment Criteria</span>
              </div>
              <ul className="text-xs text-zinc-300 space-y-1.5">
                <li className="flex items-center gap-2">
                  <span className={cn('w-2 h-2 rounded-full', isCentered ? 'bg-emerald-400' : 'bg-amber-400')} />
                  Body Centering: {isCentered ? 'Centered on plumb line ✓' : 'Align with center line'}
                </li>
                <li className="flex items-center gap-2">
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full',
                      calibrationData.distanceStatus === 'optimal' ? 'bg-emerald-400' : 'bg-amber-400'
                    )}
                  />
                  Distance Status: {calibrationData.distanceStatus.toUpperCase()}
                </li>
                <li className="flex items-center gap-2">
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full',
                      areRequiredJointsValid ? 'bg-emerald-400' : 'bg-amber-400'
                    )}
                  />
                  Key Joints Detected: {calibrationData.passedRequired}/{calibrationData.totalRequired}
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Tab 3: Motion Preview Test */}
        {activeTab === 'test' && (
          <div className="p-4 rounded-xl bg-zinc-900/80 border border-line space-y-2">
            <h4 className="text-xs font-semibold text-zinc-200 flex items-center gap-2">
              <Zap className="w-4 h-4 text-volt-adaptive" />
              Practice Motion Range Check
            </h4>
            <p className="text-xs text-zinc-300">
              Perform a quick test movement (e.g. gentle knee bend or arm elevation) in front of the
              camera to confirm that joint markers remain tracked within the grid boundaries.
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs font-mono text-zinc-400">
              <span>Overall Tracking Confidence:</span>
              <strong className="text-volt-adaptive">{calibrationData.overallConfidence}%</strong>
            </div>
          </div>
        )}

        {/* Gated Action Footer - Ensures correct positioning & joint detection before workout begins */}
        <div className="pt-2 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {isCalibrationLocked ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRecalibrate}
                icon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                Recalibrate
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (isPositionValid && areRequiredJointsValid) {
                    setIsCalibrationLocked(true);
                    globalVoiceCoach.speakMilestone('Position confirmed. Ready for workout.');
                  }
                }}
                disabled={!isPositionValid || !areRequiredJointsValid}
                icon={<Check className="w-3.5 h-3.5" />}
              >
                Confirm Alignment
              </Button>
            )}
          </div>

          <div className="w-full sm:w-auto flex items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!canStartWorkout || countdown !== null}
              onClick={handleStartWorkout}
              icon={canStartWorkout ? <Play className="w-4 h-4 fill-current" /> : <Lock className="w-4 h-4" />}
              className={cn(
                canStartWorkout
                  ? 'shadow-[0_0_20px_rgba(204,255,0,0.4)] animate-pulse hover:animate-none'
                  : 'opacity-50 cursor-not-allowed'
              )}
            >
              {canStartWorkout
                ? 'Start Workout (Calibrated)'
                : !isPositionValid
                ? 'Align Position in Grid to Unlock'
                : !areRequiredJointsValid
                ? `Detecting Joints (${calibrationData.passedRequired}/${calibrationData.totalRequired})`
                : 'Hold Position to Unlock'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export { PreWorkoutCalibration as CameraSetupGuide };
