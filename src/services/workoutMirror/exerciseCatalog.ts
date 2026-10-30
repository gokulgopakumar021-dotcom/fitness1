import { ExerciseDefinition, WorkoutMirrorExerciseId } from '../../types/workoutMirror';

export const EXERCISE_CATALOG: Record<WorkoutMirrorExerciseId, ExerciseDefinition> = {
  squat: {
    id: 'squat',
    name: 'Bodyweight Squat',
    category: 'bodyweight',
    difficulty: 'beginner',
    primaryMuscles: ['Quadriceps', 'Glutes'],
    secondaryMuscles: ['Hamstrings', 'Core', 'Calves'],
    equipment: 'Bodyweight only',
    recommendedCameraAngle: 'diagonal_45',
    cameraAngleExplanation:
      'Position device at 45° angle or side profile, elevated around hip height for optimal depth and knee tracking.',
    instructions: [
      'Stand with feet shoulder-width apart, toes turned slightly out.',
      'Brace your core and initiate by hinging hips back and bending knees.',
      'Descend until thighs are parallel to the floor (hip crease below top of knee).',
      'Drive through your midfoot and heels to return to standing lockout.',
    ],
    techniquePoints: [
      'Track knees over toes without allowing knees to collapse inward.',
      'Maintain a proud chest and neutral spine; avoid excessive forward torso collapse.',
      'Achieve parallel or below-parallel depth before standing back up.',
    ],
    supportedChecks: [
      'Knee flexion angle & depth estimation',
      'Inward knee collapse (valgus) detection',
      'Torso forward incline angle',
      'Full standing lockout validation',
      'Left/right knee symmetry',
    ],
    knownLimitations: [
      'Pure front angle cannot verify exact hip hinge depth.',
      'Loose baggy clothing may reduce knee joint visibility slightly.',
    ],
    defaultTargetReps: 12,
  },

  pushup: {
    id: 'pushup',
    name: 'Standard Push-Up',
    category: 'bodyweight',
    difficulty: 'intermediate',
    primaryMuscles: ['Chest (Pectorals)', 'Triceps'],
    secondaryMuscles: ['Anterior Deltoids', 'Core / Rectus Abdominis'],
    equipment: 'Floor space / Mat',
    recommendedCameraAngle: 'side',
    cameraAngleExplanation:
      'Place phone on the floor or a low stand 6-8 feet to the side so your entire body from head to heels is in view.',
    instructions: [
      'Assume a rigid plank position with hands slightly wider than shoulder-width.',
      'Engage glutes and core so your body forms a straight line from ears to ankles.',
      'Lower your chest until elbows reach approximately 90 degrees.',
      'Press through palms to return to full arm extension.',
    ],
    techniquePoints: [
      'Prevent hip sagging toward the floor or piking hips into the air.',
      'Keep elbows at a 45° to 60° arrow angle, rather than flaring out at 90°.',
      'Reach full extension at the top of each rep without craning the neck.',
    ],
    supportedChecks: [
      'Elbow flexion range of motion (<= 90° target)',
      'Shoulder-hip-ankle linear body alignment',
      'Hip sagging warning (core collapse)',
      'Excessive hip piking detection',
      'Full lockout at top',
    ],
    knownLimitations: [
      'Front-only camera angle hides hip sag and torso curvature.',
      'Camera must be low enough to capture ground-level body alignment.',
    ],
    defaultTargetReps: 10,
  },

  forward_lunge: {
    id: 'forward_lunge',
    name: 'Forward Lunge',
    category: 'bodyweight',
    difficulty: 'intermediate',
    primaryMuscles: ['Quadriceps', 'Glutes'],
    secondaryMuscles: ['Hamstrings', 'Calves', 'Core stabilizers'],
    equipment: 'Bodyweight only',
    recommendedCameraAngle: 'diagonal_45',
    cameraAngleExplanation:
      'Position camera 6-8 feet away at 45° to track both lead leg flexion and torso uprightness.',
    instructions: [
      'Stand tall with feet hip-width apart.',
      'Step forward smoothly, planting lead heel first.',
      'Lower your hips until both knees form roughly 90° angles.',
      'Push forcefully off the front foot to return to the starting position.',
    ],
    techniquePoints: [
      'Keep torso upright with shoulders stacked over hips.',
      'Avoid letting the lead knee track far past the toes or wobble inward.',
      'Control the descent; do not slam the trailing knee into the floor.',
    ],
    supportedChecks: [
      'Lead knee flexion depth (~90° angle)',
      'Torso verticality and forward pitch check',
      'Lead knee alignment over ankle',
      'Rep cycle completion back to standing',
    ],
    knownLimitations: [
      'Very rapid stepping can blur foot landing on low framerate cameras.',
    ],
    defaultTargetReps: 10,
  },

  reverse_lunge: {
    id: 'reverse_lunge',
    name: 'Reverse Lunge',
    category: 'bodyweight',
    difficulty: 'intermediate',
    primaryMuscles: ['Glutes', 'Hamstrings', 'Quadriceps'],
    secondaryMuscles: ['Core stabilizers', 'Calves'],
    equipment: 'Bodyweight only',
    recommendedCameraAngle: 'diagonal_45',
    cameraAngleExplanation:
      'Position camera at a 45° or side angle to observe step-back distance and shin verticality.',
    instructions: [
      'Stand upright with feet together.',
      'Step backward with one leg, landing on the ball of the rear foot.',
      'Lower hips until front thigh is parallel to the ground.',
      'Drive through front heel to step forward back to starting position.',
    ],
    techniquePoints: [
      'Maintain an upright posture with chest elevated.',
      'Keep front shin relatively vertical and front knee tracking forward.',
      'Distribute weight primarily through front leg.',
    ],
    supportedChecks: [
      'Front knee flexion depth (~90° angle)',
      'Upright torso alignment',
      'Return to dual-foot standing lockout',
      'Left/right leg balance',
    ],
    knownLimitations: [
      'Back leg may be occluded if device is placed directly facing lead side.',
    ],
    defaultTargetReps: 10,
  },

  shoulder_press: {
    id: 'shoulder_press',
    name: 'Dumbbell Shoulder Press',
    category: 'strength',
    difficulty: 'intermediate',
    primaryMuscles: ['Deltoids (Shoulders)'],
    secondaryMuscles: ['Triceps', 'Upper Pectorals', 'Trapezius', 'Core'],
    equipment: 'Dumbbells or light weights (or bodyweight mock)',
    recommendedCameraAngle: 'front',
    cameraAngleExplanation:
      'Position phone straight ahead at chest height, 5-7 feet away so hands at overhead lockout remain in frame.',
    instructions: [
      'Stand with weights at shoulder height, palms facing forward or neutral.',
      'Brace core and glutes to prevent hyperextending lower back.',
      'Press weights straight overhead until arms are fully extended.',
      'Lower under control back to shoulder height.',
    ],
    techniquePoints: [
      'Lock out arms fully overhead without arching the lower spine.',
      'Press both arms symmetrically at identical speed and height.',
      'Avoid shrugging shoulders up to ears at top of press.',
    ],
    supportedChecks: [
      'Elbow lockout overhead (elbow angle >= 165°)',
      'Left vs right arm symmetry and elevation height',
      'Torso verticality (detecting excessive lower back arch)',
      'Controlled eccentric lowering to shoulder level',
    ],
    knownLimitations: [
      'Camera must be tilted up enough so overhead hands do not clip off top of frame.',
    ],
    defaultTargetReps: 10,
  },

  bicep_curl: {
    id: 'bicep_curl',
    name: 'Bicep Curl',
    category: 'strength',
    difficulty: 'beginner',
    primaryMuscles: ['Biceps Brachii'],
    secondaryMuscles: ['Brachialis', 'Brachioradialis (Forearms)'],
    equipment: 'Dumbbells or resistance bands (or bodyweight)',
    recommendedCameraAngle: 'front_or_side',
    cameraAngleExplanation:
      'Face camera directly or at 45° angle, standing 5-7 feet away so elbows and wrists are clearly visible.',
    instructions: [
      'Stand tall with weights at sides, arms extended.',
      'Pin elbows beside your ribcage.',
      'Curl weights upward toward shoulders by flexing elbows.',
      'Squeeze biceps at top, then lower smoothly to full extension.',
    ],
    techniquePoints: [
      'Keep elbows stationary at ribs; do not swing elbows forward.',
      'Complete full range of motion: extend arms fully at the bottom.',
      'Avoid rocking your torso or using momentum to swing the weight.',
    ],
    supportedChecks: [
      'Elbow flexion peak angle (<= 60° target)',
      'Bottom lockout / full arm extension (elbow angle >= 150°)',
      'Elbow drift / swinging warning',
      'Left and right arm synchronization',
    ],
    knownLimitations: [
      'Overly fast swings may challenge 30fps landmark tracking.',
    ],
    defaultTargetReps: 12,
  },

  plank: {
    id: 'plank',
    name: 'Core Plank (Static Hold)',
    category: 'core',
    difficulty: 'intermediate',
    primaryMuscles: ['Core / Transverse Abdominis', 'Rectus Abdominis'],
    secondaryMuscles: ['Shoulders', 'Glutes', 'Quadriceps'],
    equipment: 'Floor space / Mat',
    recommendedCameraAngle: 'side',
    cameraAngleExplanation:
      'Position phone horizontally on floor or low stand to your side for direct profile view of spine line.',
    instructions: [
      'Place forearms or palms on the floor under shoulders, elbows bent 90°.',
      'Extend legs straight back, resting on balls of your feet.',
      'Tuck pelvis slightly, brace abs hard, and contract glutes.',
      'Hold the posture steadily while breathing normally.',
    ],
    techniquePoints: [
      'Keep a straight neutral spine from crown of head through hips to heels.',
      'Do not allow hips to sag downward into lumbar hyperextension.',
      'Do not pike hips high into a tent or downward dog shape.',
    ],
    supportedChecks: [
      'Shoulder-hip-ankle collinearity (160° - 190° acceptable window)',
      'Hip sagging alert (spine angle < 160°)',
      'Hip pike alert (spine angle > 195°)',
      'Real-time duration timer with "Good Form" hold score',
    ],
    knownLimitations: [
      'Side camera angle is strictly required for planar spine line assessment.',
    ],
    defaultTargetDurationSec: 45,
    isStaticHold: true,
  },

  jumping_jack: {
    id: 'jumping_jack',
    name: 'Jumping Jack',
    category: 'cardio',
    difficulty: 'beginner',
    primaryMuscles: ['Full Body / Cardiovascular'],
    secondaryMuscles: ['Calves', 'Deltoids', 'Glutes', 'Core'],
    equipment: 'Open floor space',
    recommendedCameraAngle: 'front',
    cameraAngleExplanation:
      'Face camera directly, placed 7-9 feet back so arms overhead and wide feet stay inside camera frame.',
    instructions: [
      'Start standing with feet together and arms resting at your sides.',
      'Jump feet outward while raising arms out to the sides and overhead.',
      'Clap or touch hands above head, then jump back to starting position.',
      'Maintain a lively, rhythmic tempo.',
    ],
    techniquePoints: [
      'Extend arms fully overhead (hands above head level).',
      'Jump feet out wider than shoulder-width.',
      'Land softly on balls of feet with knees slightly relaxed.',
    ],
    supportedChecks: [
      'Shoulder abduction angle (> 150° overhead)',
      'Leg separation distance at jump width',
      'Arm and leg coordination synchronization',
      'Repetition cadence and tempo consistency',
    ],
    knownLimitations: [
      'Requires full height and width clearance in the camera view.',
    ],
    defaultTargetReps: 25,
  },
};

export const ALL_EXERCISE_IDS: WorkoutMirrorExerciseId[] = [
  'squat',
  'pushup',
  'forward_lunge',
  'reverse_lunge',
  'shoulder_press',
  'bicep_curl',
  'plank',
  'jumping_jack',
];
