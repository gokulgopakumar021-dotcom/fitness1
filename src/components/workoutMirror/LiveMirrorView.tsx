import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Info,
  Square,
  Plus,
  Minus,
  Sparkles,
  Camera,
} from 'lucide-react';
import {
  ExerciseDefinition,
  MirrorPoint,
  MirrorSetData,
  RepetitionRecord,
  MovementPhase,
} from '../../types/workoutMirror';
import { CameraController } from '../../services/camera';
import { mirrorPoseService } from '../../services/workoutMirror/mirrorPoseService';
import { createExerciseEngine, IExerciseEngine } from '../../services/workoutMirror/exerciseEngines';
import { FeedbackEngine, ActiveFeedbackItem } from '../../services/workoutMirror/feedbackEngine';
import { globalVoiceCoach } from '../../services/workoutMirror/voiceCoach';
import {
  LandmarkSmoothingFilter,
  evaluateBodyVisibility,
} from '../../services/workoutMirror/jointGeometry';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { cn } from '../ui/cn';

interface LiveMirrorViewProps {
  exercise: ExerciseDefinition;
  cameraController: CameraController;
  initialSetNumber?: number;
  targetReps?: number;
  targetDurationSec?: number;
  onSetCompleted: (setData: MirrorSetData) => void;
  onCancelSession: () => void;
}

export const LiveMirrorView: React.FC<LiveMirrorViewProps> = ({
  exercise,
  cameraController,
  initialSetNumber = 1,
  targetReps,
  targetDurationSec,
  onSetCompleted,
  onCancelSession,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [cameraState, setCameraState] = useState(() => cameraController.getState());
  const [isPaused, setIsPaused] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(() => globalVoiceCoach.getEnabled());
  const [showSkeleton, setShowSkeleton] = useState(true);

  const [repCount, setRepCount] = useState(0);
  const [userAdjustedReps, setUserAdjustedReps] = useState(0);
  const [phase, setPhase] = useState<MovementPhase>('idle');
  const [formScore, setFormScore] = useState(95);
  const [trackingConfidence, setTrackingConfidence] = useState(100);
  const [activeFeedback, setActiveFeedback] = useState<ActiveFeedbackItem | null>(null);
  const [repCompletedPulse, setRepCompletedPulse] = useState(false);

  const [sessionStartTime] = useState(() => Date.now());
  const [activeSeconds, setActiveSeconds] = useState(0);

  // Engine, filter, feedback instances
  const engineRef = useRef<IExerciseEngine>(createExerciseEngine(exercise.id));
  const filterRef = useRef<LandmarkSmoothingFilter>(new LandmarkSmoothingFilter(0.65));
  const feedbackRef = useRef<FeedbackEngine>(new FeedbackEngine());
  const repRecordsRef = useRef<RepetitionRecord[]>([]);
  const frameScoresRef = useRef<number[]>([]);
  const animFrameRef = useRef<number | null>(null);

  // Sync voice coach setting
  const toggleVoice = () => {
    const next = !isVoiceEnabled;
    setIsVoiceEnabled(next);
    globalVoiceCoach.setEnabled(next);
  };

  // Timer loop for workout duration
  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setActiveSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isPaused]);

  // Subscribe to camera updates & video stream attachment
  useEffect(() => {
    const unsub = cameraController.subscribe(() => {
      setCameraState(cameraController.getState());
    });
    return unsub;
  }, [cameraController]);

  useEffect(() => {
    if (videoRef.current && cameraState.stream) {
      videoRef.current.srcObject = cameraState.stream;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraState.stream]);

  // Main high-performance frame processing loop
  useEffect(() => {
    if (cameraState.status !== 'granted') return;

    let isRunning = true;

    const loop = (timestamp: number) => {
      if (!isRunning) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!isPaused && video && video.readyState >= 2) {
        // Run on-device MediaPipe inference
        const rawLandmarks = mirrorPoseService.detectForVideo(video, timestamp);

        if (rawLandmarks) {
          // Smooth jitter
          const smoothed = filterRef.current.filter(rawLandmarks);

          // Evaluate visibility & tracking quality
          const visibility = evaluateBodyVisibility(smoothed);
          setTrackingConfidence(Math.round(visibility.averageConfidence * 100));

          // Analyze exercise technique and repetitions
          const engine = engineRef.current;
          const result = engine.processFrame(smoothed, timestamp);

          setPhase(result.movementPhase);
          setRepCount(result.repCount);
          setFormScore(result.formScoreThisFrame);
          frameScoresRef.current.push(result.formScoreThisFrame);

          // Handle repetition event
          if (result.repCompletedThisFrame) {
            setRepCompletedPulse(true);
            setTimeout(() => setRepCompletedPulse(false), 800);

            globalVoiceCoach.speakRepCount(result.repCount);

            repRecordsRef.current.push({
              repNumber: result.repCount,
              durationMs: 2000,
              formScore: result.formScoreThisFrame,
              observations: [...result.observations],
              wasCameraVerified: true,
            });
          }

          // Handle feedback & voice corrections
          const feedbackResult = feedbackRef.current.processObservations(
            result.observations,
            timestamp
          );
          setActiveFeedback(feedbackResult.active);

          if (feedbackResult.newSpeechCue && !result.repCompletedThisFrame) {
            globalVoiceCoach.speakCorrection(feedbackResult.newSpeechCue);
          }

          // Render high-contrast skeleton overlay
          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              canvas.width = video.videoWidth || 640;
              canvas.height = video.videoHeight || 480;

              if (showSkeleton) {
                let theme: 'volt' | 'warning' | 'alert' = 'volt';
                if (result.formScoreThisFrame < 70) theme = 'alert';
                else if (result.formScoreThisFrame < 85) theme = 'warning';

                mirrorPoseService.drawSkeleton(ctx, smoothed, canvas.width, canvas.height, {
                  highlightJoints: feedbackResult.active?.highlightJoints,
                  colorTheme: theme,
                  mirrorHorizontally: cameraState.facing === 'user',
                });
              } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
              }
            }
          }
        } else {
          // No person detected in this frame
          setTrackingConfidence(0);
          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      isRunning = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [cameraState.status, cameraState.facing, isPaused, showSkeleton]);

  // Adjust rep manually if needed
  const handleManualRepAdjust = (delta: number) => {
    const next = Math.max(0, repCount + userAdjustedReps + delta);
    setUserAdjustedReps((prev) => prev + delta);
    engineRef.current.setRepCount(next);
  };

  // Complete Set handler
  const handleFinishSet = useCallback(() => {
    globalVoiceCoach.stop();

    const finalReps = repCount + userAdjustedReps;
    const scores = frameScoresRef.current;
    const avgScore =
      scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 85;

    const setData: MirrorSetData = {
      setNumber: initialSetNumber,
      targetReps: targetReps ?? exercise.defaultTargetReps,
      targetDurationSec: targetDurationSec ?? exercise.defaultTargetDurationSec,
      detectedReps: repCount,
      userAdjustedReps: finalReps,
      activeDurationSec: activeSeconds,
      averageFormScore: avgScore,
      reps: repRecordsRef.current,
      observationsSummary: feedbackRef.current.getObservationsSummary(),
    };

    onSetCompleted(setData);
  }, [
    initialSetNumber,
    repCount,
    userAdjustedReps,
    activeSeconds,
    targetReps,
    targetDurationSec,
    exercise,
    onSetCompleted,
  ]);

  const targetCount = exercise.isStaticHold
    ? targetDurationSec ?? exercise.defaultTargetDurationSec ?? 45
    : targetReps ?? exercise.defaultTargetReps ?? 12;

  const currentCount = repCount + userAdjustedReps;

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative flex flex-col h-[calc(100dvh-5.5rem)] lg:h-[calc(100dvh-6rem)] max-w-5xl mx-auto rounded-3xl overflow-hidden bg-black border border-line shadow-2xl select-none">
      {/* Edge-to-edge Viewport */}
      <div className="relative flex-1 w-full h-full overflow-hidden flex items-center justify-center bg-zinc-950">
        {/* Video feed */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={cn(
            'absolute inset-0 w-full h-full object-cover',
            cameraState.facing === 'user' && '-scale-x-100'
          )}
        />

        {/* Skeleton Canvas Overlay */}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover pointer-events-none" />

        {/* Celebration Flash upon Rep Completion */}
        {repCompletedPulse && (
          <div className="absolute inset-0 bg-accent/20 pointer-events-none animate-in fade-in duration-150" />
        )}

        {/* Paused Dimmer */}
        {isPaused && (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6 text-center">
            <Pause className="w-16 h-16 text-volt-adaptive mb-3" />
            <h3 className="text-2xl font-bold text-white">Workout Paused</h3>
            <p className="text-xs text-zinc-300 max-w-xs mt-1 mb-6">
              Take a breath. Press resume when you are ready to continue.
            </p>
            <div className="flex gap-3">
              <Button
                variant="primary"
                size="lg"
                onClick={() => setIsPaused(false)}
                icon={<Play className="w-4 h-4 fill-current" />}
              >
                Resume
              </Button>
              <Button variant="secondary" size="lg" onClick={handleFinishSet}>
                End Set
              </Button>
            </div>
          </div>
        )}

        {/* Top HUD Overlay */}
        <div className="absolute top-0 inset-x-0 p-4 sm:p-6 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-start justify-between z-20">
          <div>
            <div className="flex items-center gap-2">
              <Badge tone="accent">Set {initialSetNumber}</Badge>
              <span className="text-xs font-semibold text-zinc-200">{exercise.name}</span>
            </div>
            <div className="text-2xl sm:text-3xl font-mono font-bold text-white mt-1">
              {formatTimer(activeSeconds)}
            </div>
          </div>

          {/* Quick HUD controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleVoice}
              className={cn(
                'p-2.5 rounded-full backdrop-blur-md border transition-colors',
                isVoiceEnabled
                  ? 'bg-accent/20 border-accent/40 text-volt-adaptive'
                  : 'bg-black/60 border-white/20 text-zinc-400'
              )}
              title={isVoiceEnabled ? 'Voice coaching active' : 'Voice muted'}
              aria-label="Toggle voice coach"
            >
              {isVoiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setShowSkeleton((prev) => !prev)}
              className={cn(
                'p-2.5 rounded-full backdrop-blur-md border transition-colors',
                showSkeleton
                  ? 'bg-accent/20 border-accent/40 text-volt-adaptive'
                  : 'bg-black/60 border-white/20 text-zinc-400'
              )}
              title={showSkeleton ? 'Skeleton overlay visible' : 'Skeleton hidden'}
              aria-label="Toggle skeleton"
            >
              {showSkeleton ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>

            {cameraState.canSwitch && (
              <button
                onClick={() => cameraController.switchCamera()}
                className="p-2.5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white hover:bg-black/80 transition-colors"
                title="Flip Camera"
                aria-label="Switch Camera"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Center Prominent Rep / Metric HUD */}
        <div className="absolute right-4 sm:right-6 top-24 z-20 flex flex-col items-end">
          <div className="p-3 sm:p-4 rounded-2xl bg-black/60 backdrop-blur-md border border-white/15 text-right shadow-2xl">
            <div className="text-[10px] uppercase font-mono tracking-wider text-zinc-400">
              {exercise.isStaticHold ? 'Good Form Hold' : 'Reps Completed'}
            </div>
            <div className="text-4xl sm:text-5xl font-black text-volt-adaptive drop-shadow-[0_0_20px_rgba(204,255,0,0.4)]">
              {currentCount}
              <span className="text-base sm:text-lg font-normal text-zinc-400 ml-1">
                / {targetCount}
                {exercise.isStaticHold && 's'}
              </span>
            </div>

            {/* Movement Phase Tag */}
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-2/80 text-[11px] font-semibold text-zinc-200 border border-line">
              <span className="w-2 h-2 rounded-full bg-volt-adaptive animate-pulse" />
              <span className="capitalize">{phase}</span>
            </div>
          </div>

          {/* Manual rep adjust buttons */}
          <div className="flex items-center gap-1.5 mt-2">
            <button
              onClick={() => handleManualRepAdjust(-1)}
              className="p-2 rounded-xl bg-black/60 backdrop-blur-md text-zinc-300 hover:text-white border border-white/10"
              title="Decrement rep"
              aria-label="Subtract 1 rep"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleManualRepAdjust(1)}
              className="p-2 rounded-xl bg-black/60 backdrop-blur-md text-zinc-300 hover:text-white border border-white/10"
              title="Increment rep"
              aria-label="Add 1 rep"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Real-time Dynamic Form Feedback Banner */}
        {activeFeedback && (
          <div className="absolute top-24 left-4 sm:left-6 z-20 max-w-xs sm:max-w-sm animate-in slide-in-from-left duration-200">
            <div
              className={cn(
                'p-3.5 rounded-2xl backdrop-blur-md border shadow-2xl flex items-start gap-2.5',
                activeFeedback.category === 'positive'
                  ? 'bg-emerald-950/85 border-emerald-500/50 text-emerald-200'
                  : activeFeedback.severity === 'warning' || activeFeedback.severity === 'error'
                  ? 'bg-amber-950/90 border-amber-500/60 text-amber-100'
                  : 'bg-zinc-900/90 border-accent/40 text-zinc-100'
              )}
            >
              {activeFeedback.category === 'positive' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : activeFeedback.severity === 'warning' ? (
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <Info className="w-5 h-5 text-accent shrink-0 mt-0.5" />
              )}
              <div className="text-xs">
                <span className="font-bold block uppercase tracking-wider text-[10px] text-zinc-400">
                  Form Coaching
                </span>
                <span className="font-semibold text-sm leading-snug">{activeFeedback.message}</span>
              </div>
            </div>
          </div>
        )}

        {/* Tracking Confidence Warning if user leaves frame */}
        {trackingConfidence < 40 && (
          <div className="absolute inset-x-6 bottom-24 flex justify-center z-20">
            <div className="px-4 py-2 rounded-xl bg-red-950/90 border border-red-500/50 text-red-200 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span>Step back into camera view for accurate tracking</span>
            </div>
          </div>
        )}

        {/* Bottom Control Bar */}
        <div className="absolute bottom-0 inset-x-0 p-4 sm:p-6 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex items-center justify-between z-20">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setIsPaused((prev) => !prev)}
              icon={
                isPaused ? (
                  <Play className="w-4 h-4 fill-current" />
                ) : (
                  <Pause className="w-4 h-4" />
                )
              }
            >
              {isPaused ? 'Resume' : 'Pause'}
            </Button>

            <button
              onClick={onCancelSession}
              className="text-xs text-zinc-400 hover:text-white px-3 py-2 transition-colors"
            >
              Discard
            </button>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              onClick={handleFinishSet}
              icon={<CheckCircle2 className="w-4 h-4" />}
            >
              Complete Set
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
