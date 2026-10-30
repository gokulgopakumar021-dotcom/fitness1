import { WorkoutMirrorExerciseId } from '../../../types/workoutMirror';
import { IExerciseEngine } from './types';
import { SquatEngine } from './squatEngine';
import { PushupEngine } from './pushupEngine';
import { LungeEngine } from './lungeEngine';
import { BicepCurlEngine } from './bicepCurlEngine';
import { ShoulderPressEngine } from './shoulderPressEngine';
import { PlankEngine } from './plankEngine';
import { JumpingJackEngine } from './jumpingJackEngine';

export * from './types';
export * from './squatEngine';
export * from './pushupEngine';
export * from './lungeEngine';
export * from './bicepCurlEngine';
export * from './shoulderPressEngine';
export * from './plankEngine';
export * from './jumpingJackEngine';

export function createExerciseEngine(exerciseId: WorkoutMirrorExerciseId): IExerciseEngine {
  switch (exerciseId) {
    case 'squat':
      return new SquatEngine();
    case 'pushup':
      return new PushupEngine();
    case 'forward_lunge':
      return new LungeEngine('forward_lunge');
    case 'reverse_lunge':
      return new LungeEngine('reverse_lunge');
    case 'shoulder_press':
      return new ShoulderPressEngine();
    case 'bicep_curl':
      return new BicepCurlEngine();
    case 'plank':
      return new PlankEngine();
    case 'jumping_jack':
      return new JumpingJackEngine();
    default:
      return new SquatEngine();
  }
}
