import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowLeft,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { ExerciseDefinition, MirrorPoint } from '../../types/workoutMirror';
import { CameraController } from '../../services/camera';
import { mirrorPoseService } from '../../services/workoutMirror/mirrorPoseService';
import { evaluateBodyVisibility } from '../../services/workoutMirror/jointGeometry';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { cn } from '../ui/cn';

interface CameraSetupGuideProps {
  exercise: ExerciseDefinition;
  cameraController: CameraController;
  onReadyToStart: (facing: 'user' | 'environment') => void;
  onCancel: () => void;
}

export const CameraSetupGuide: React.FC<CameraSetupGuideProps> = ({
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
  const [modelError, setModelError] = useState<string | null>(null);

  const [landmarks, setLandmarks] = useState<MirrorPoint[] | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Subscribe to camera updates
  useEffect(() => {
    const unsub = cameraController.subscribe(() => {
      setCameraState(cameraController.getState());
    });
    return unsub;
  }, [cameraController]);

  // Start camera if not running
  useEffect(() => {
    if (cameraState.status === 'not_requested') {
      cameraController.start({ facingMode: 'user' });
    }
  }, [cameraState.status, cameraController]);

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && cameraState.stream) {
      videoRef.current.srcObject = cameraState.stream;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraState.stream]);

  // Initialize MediaPipe pose model
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
        .catch((err) => {
          if (mounted) {
            setModelLoading(false);
            setModelError(err?.message || 'Failed to load pose model');
          }
        });
    }
    return () => {
      mounted = false;
    };
  }, []);

  // Frame processing loop for setup positioning
  useEffect(() => {
    if (cameraState.status !== 'granted' || !modelReady) return;

    let isRunning = true;

    const tick = () => {
      if (!isRunning) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && video.readyState >= 2) {
        const detected = mirrorPoseService.detectForVideo(video, performance.now());
        setLandmarks(detected);

        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            if (detected) {
              mirrorPoseService.drawSkeleton(ctx, detected, canvas.width, canvas.height, {
                colorTheme: 'cyan',
                mirrorHorizontally: cameraState.facing === 'user',
              });
            } else {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  }, [cameraState.status, cameraState.facing, modelReady]);

  // Handle start countdown
  const handleStartCountdown = () => {
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
      // Countdown finished
      onReadyToStart(cameraState.facing === 'environment' ? 'environment' : 'user');
    }
  }, [countdown, onReadyToStart, cameraState.facing]);

  const bodyStatus = evaluateBodyVisibility(landmarks);

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Exercises</span>
        </button>

        <div className="flex items-center gap-2">
          <Badge tone="accent">{exercise.name}</Badge>
          <Badge tone={modelReady ? 'success' : 'warning'}>
            {modelReady ? 'Pose Engine Ready' : modelLoading ? 'Loading AI Model...' : 'Waiting for Model'}
          </Badge>
        </div>
      </div>

      {/* Main Camera Viewfinder Card */}
      <div className="relative aspect-[3/4] sm:aspect-[4/3] max-h-[68vh] w-full bg-zinc-950 rounded-2xl overflow-hidden border border-line shadow-2xl flex items-center justify-center">
        {/* Live Video */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={cn(
            'absolute inset-0 w-full h-full object-cover',
            cameraState.facing === 'user' && '-scale-x-100'
          )}
        />

        {/* Skeleton Canvas */}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover pointer-events-none" />

        {/* Framing Guide Overlay (dashed outline) */}
        <div className="absolute inset-6 sm:inset-10 border-2 border-dashed border-white/20 rounded-2xl pointer-events-none flex flex-col items-center justify-between p-4">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/50">
            Head Zone
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/50">
            Feet Zone
          </span>
        </div>

        {/* Camera Permission / Error Fallback */}
        {cameraState.status === 'requesting' && (
          <div className="absolute inset-0 bg-zinc-950/90 flex flex-col items-center justify-center p-6 text-center z-20">
            <Camera className="w-12 h-12 text-accent animate-pulse mb-3" />
            <h3 className="text-lg font-bold text-zinc-100">Requesting Camera Access</h3>
            <p className="text-xs text-zinc-400 max-w-sm mt-1">
              Please allow camera access in your browser prompt so the AI can track your movement.
            </p>
          </div>
        )}

        {cameraState.status === 'denied' && (
          <div className="absolute inset-0 bg-zinc-950/95 flex flex-col items-center justify-center p-6 text-center z-20">
            <AlertCircle className="w-12 h-12 text-danger mb-3" />
            <h3 className="text-lg font-bold text-zinc-100">Camera Permission Blocked</h3>
            <p className="text-xs text-zinc-400 max-w-sm mt-1">
              IronLog AI needs camera access to operate the Workout Mirror. Please enable camera access in
              your browser or device settings and try again.
            </p>
            <Button
              variant="secondary"
              size="md"
              className="mt-4"
              onClick={() => cameraController.start({ facingMode: 'user' })}
            >
              Try Again
            </Button>
          </div>
        )}

        {/* Countdown Overlay */}
        {countdown !== null && (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center z-30 animate-in fade-in duration-200">
            <div className="text-7xl sm:text-9xl font-black text-volt-adaptive drop-shadow-[0_0_35px_rgba(204,255,0,0.8)]">
              {countdown > 0 ? countdown : 'GO!'}
            </div>
            <p className="text-sm font-semibold text-zinc-200 mt-4">
              Get into position for {exercise.name}
            </p>
          </div>
        )}

        {/* Camera Controls Overlay */}
        <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
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

        {/* Framing & Distance Guidance Pill */}
        <div className="absolute bottom-4 inset-x-4 flex justify-center z-10">
          <div
            className={cn(
              'px-4 py-2.5 rounded-xl backdrop-blur-md text-xs font-medium flex items-center gap-2 shadow-lg border max-w-md text-center',
              bodyStatus.isFullyVisible
                ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200'
                : 'bg-zinc-900/90 border-amber-500/40 text-amber-200'
            )}
          >
            {bodyStatus.isFullyVisible ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span>{bodyStatus.advice}</span>
          </div>
        </div>
      </div>

      {/* Positioning Tip Card & Action Button */}
      <Card className="p-4 border-line flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-accent/10 border border-accent/25 text-accent shrink-0">
            <Camera className="w-5 h-5 text-volt-adaptive" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-zinc-100 uppercase tracking-wider">
              Recommended Placement for {exercise.name}
            </h4>
            <p className="text-xs text-zinc-300 mt-0.5">{exercise.cameraAngleExplanation}</p>
          </div>
        </div>

        <div className="w-full sm:w-auto flex items-center gap-2">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={!modelReady || countdown !== null}
            onClick={handleStartCountdown}
            icon={<Play className="w-4 h-4 fill-current" />}
          >
            Start Workout
          </Button>
        </div>
      </Card>
    </div>
  );
};
