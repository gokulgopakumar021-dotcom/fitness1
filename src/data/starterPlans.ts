import { WorkoutPlan } from '../types';

export const STARTER_PPL_PLAN: WorkoutPlan = {
  id: 'starter-ppl-6day',
  name: '6-Day Push / Pull / Legs (PPL)',
  trainingSplit: 'Push / Pull / Legs',
  description: 'Evidence-based progressive overload template targeting all major muscle groups twice weekly.',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  isActive: false, // User can choose to activate
  isStarter: true,
  days: [
    {
      id: 'ppl-day-1',
      dayName: 'Day 1 — Push A (Chest, Shoulders, Triceps)',
      dayOrder: 1,
      exercises: [
        {
          id: 'ppl-ex-1',
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          equipment: 'barbell',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 120,
          tempo: '3-0-1-0',
          notes: 'Lower under control to mid-sternum. Retract scapulae.'
        },
        {
          id: 'ppl-ex-2',
          name: 'Incline Dumbbell Press',
          muscleGroup: 'Chest',
          equipment: 'dumbbell',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 90,
          notes: '30-degree incline. Maintain continuous tension on upper pecs.'
        },
        {
          id: 'ppl-ex-3',
          name: 'Standing Overhead Barbell Press',
          muscleGroup: 'Shoulders',
          equipment: 'barbell',
          workingSets: 3,
          repRange: '6-10',
          targetRir: 2,
          restSeconds: 120,
          notes: 'Brace core and glutes. Press straight upward with full lockout.'
        },
        {
          id: 'ppl-ex-4',
          name: 'Cable Lateral Raise',
          muscleGroup: 'Shoulders',
          equipment: 'cable',
          workingSets: 3,
          repRange: '12-15',
          targetRir: 1,
          restSeconds: 60,
          notes: 'Lead with elbow. Keep traps depressed.'
        },
        {
          id: 'ppl-ex-5',
          name: 'Triceps Rope Pushdown',
          muscleGroup: 'Arms',
          equipment: 'cable',
          workingSets: 3,
          repRange: '10-15',
          targetRir: 1,
          restSeconds: 60,
          notes: 'Lock elbows at your sides. Flare rope slightly at full extension.'
        }
      ]
    },
    {
      id: 'ppl-day-2',
      dayName: 'Day 2 — Pull A (Back, Biceps, Rear Delts)',
      dayOrder: 2,
      exercises: [
        {
          id: 'ppl-ex-6',
          name: 'Conventional Barbell Deadlift',
          muscleGroup: 'Back',
          equipment: 'barbell',
          workingSets: 3,
          repRange: '5-8',
          targetRir: 2,
          restSeconds: 180,
          notes: 'Tight lats, neutral spine, push the floor away.'
        },
        {
          id: 'ppl-ex-7',
          name: 'Lat Pulldown',
          muscleGroup: 'Back',
          equipment: 'cable',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 90,
          notes: 'Pull to collarbone with high chest, control eccentric.'
        },
        {
          id: 'ppl-ex-8',
          name: 'Seated Cable Row',
          muscleGroup: 'Back',
          equipment: 'cable',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 90,
          notes: 'Neutral grip, drive elbows back towards hips.'
        },
        {
          id: 'ppl-ex-9',
          name: 'Face Pull',
          muscleGroup: 'Shoulders',
          equipment: 'cable',
          workingSets: 3,
          repRange: '12-15',
          targetRir: 2,
          restSeconds: 60,
          notes: 'Pull towards eyes with external shoulder rotation.'
        },
        {
          id: 'ppl-ex-10',
          name: 'Barbell Bicep Curl',
          muscleGroup: 'Arms',
          equipment: 'barbell',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 1,
          restSeconds: 60,
          notes: 'Strict form, no swinging from hips.'
        }
      ]
    },
    {
      id: 'ppl-day-3',
      dayName: 'Day 3 — Legs A (Quads, Hamstrings, Calves)',
      dayOrder: 3,
      exercises: [
        {
          id: 'ppl-ex-11',
          name: 'Barbell Back Squat',
          muscleGroup: 'Quads',
          equipment: 'barbell',
          workingSets: 3,
          repRange: '6-10',
          targetRir: 2,
          restSeconds: 150,
          notes: 'Depth below parallel. Solid foot tripod balance.'
        },
        {
          id: 'ppl-ex-12',
          name: 'Romanian Deadlift (RDL)',
          muscleGroup: 'Hamstrings',
          equipment: 'barbell',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 120,
          notes: 'Hinge hips backwards, soft bend in knees, stretch hamstrings.'
        },
        {
          id: 'ppl-ex-13',
          name: 'Leg Press',
          muscleGroup: 'Quads',
          equipment: 'machine',
          workingSets: 3,
          repRange: '10-15',
          targetRir: 1,
          restSeconds: 90,
          notes: 'Do not lock out knees aggressively at top.'
        },
        {
          id: 'ppl-ex-14',
          name: 'Standing Calf Raise',
          muscleGroup: 'Calves',
          equipment: 'machine',
          workingSets: 4,
          repRange: '12-15',
          targetRir: 1,
          restSeconds: 60,
          notes: 'Full deep stretch at bottom, 1s pause at peak contraction.'
        }
      ]
    },
    {
      id: 'ppl-day-4',
      dayName: 'Day 4 — Push B (Chest, Shoulders, Triceps)',
      dayOrder: 4,
      exercises: [
        {
          id: 'ppl-ex-15',
          name: 'Dumbbell Flat Bench Press',
          muscleGroup: 'Chest',
          equipment: 'dumbbell',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 90,
          notes: 'Deep stretch at bottom, convergent press at top.'
        },
        {
          id: 'ppl-ex-16',
          name: 'Dumbbell Seated Shoulder Press',
          muscleGroup: 'Shoulders',
          equipment: 'dumbbell',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 90,
          notes: 'Elbows slightly tucked in scapular plane.'
        },
        {
          id: 'ppl-ex-17',
          name: 'Incline Cable Flye',
          muscleGroup: 'Chest',
          equipment: 'cable',
          workingSets: 3,
          repRange: '12-15',
          targetRir: 1,
          restSeconds: 60,
          notes: 'Continuous tension through pectoral contraction.'
        },
        {
          id: 'ppl-ex-18',
          name: 'Dips (Chest / Triceps)',
          muscleGroup: 'Arms',
          equipment: 'bodyweight',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 90,
          notes: 'Lean forward slightly for chest focus, or upright for triceps.'
        }
      ]
    },
    {
      id: 'ppl-day-5',
      dayName: 'Day 5 — Pull B (Back, Biceps, Rear Delts)',
      dayOrder: 5,
      exercises: [
        {
          id: 'ppl-ex-19',
          name: 'Weighted Pull-Up / Bodyweight Pull-Up',
          muscleGroup: 'Back',
          equipment: 'bodyweight',
          workingSets: 3,
          repRange: '6-10',
          targetRir: 2,
          restSeconds: 120,
          notes: 'Full dead-hang at bottom, chest to bar.'
        },
        {
          id: 'ppl-ex-20',
          name: 'Chest Supported Dumbbell Row',
          muscleGroup: 'Back',
          equipment: 'dumbbell',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 90,
          notes: 'Isolates upper back and lats without lower back strain.'
        },
        {
          id: 'ppl-ex-21',
          name: 'Incline Dumbbell Curl',
          muscleGroup: 'Arms',
          equipment: 'dumbbell',
          workingSets: 3,
          repRange: '10-12',
          targetRir: 1,
          restSeconds: 60,
          notes: 'Emphasizes long head stretch on biceps.'
        },
        {
          id: 'ppl-ex-22',
          name: 'Hammer Curl',
          muscleGroup: 'Arms',
          equipment: 'dumbbell',
          workingSets: 3,
          repRange: '10-12',
          targetRir: 1,
          restSeconds: 60,
          notes: 'Neutral grip for brachialis and forearms.'
        }
      ]
    },
    {
      id: 'ppl-day-6',
      dayName: 'Day 6 — Legs B (Hamstrings, Quads, Calves)',
      dayOrder: 6,
      exercises: [
        {
          id: 'ppl-ex-23',
          name: 'Bulgarian Split Squat',
          muscleGroup: 'Quads',
          equipment: 'dumbbell',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 90,
          isUnilateral: true,
          notes: 'Rear foot on bench. Drive through front heel.'
        },
        {
          id: 'ppl-ex-24',
          name: 'Lying Leg Curl',
          muscleGroup: 'Hamstrings',
          equipment: 'machine',
          workingSets: 3,
          repRange: '10-15',
          targetRir: 1,
          restSeconds: 60,
          notes: 'Keep hips pinned to pad during contraction.'
        },
        {
          id: 'ppl-ex-25',
          name: 'Leg Extension',
          muscleGroup: 'Quads',
          equipment: 'machine',
          workingSets: 3,
          repRange: '12-15',
          targetRir: 1,
          restSeconds: 60,
          notes: '2-second eccentric phase. Peak contraction at top.'
        },
        {
          id: 'ppl-ex-26',
          name: 'Seated Calf Raise',
          muscleGroup: 'Calves',
          equipment: 'machine',
          workingSets: 4,
          repRange: '12-15',
          targetRir: 1,
          restSeconds: 60,
          notes: 'Soleus focus. Controlled stretch.'
        }
      ]
    }
  ]
};

export const STARTER_UPPER_LOWER_PLAN: WorkoutPlan = {
  id: 'starter-upper-lower-4day',
  name: '4-Day Upper / Lower Split',
  trainingSplit: 'Upper / Lower',
  description: 'Efficient 4-day frequency ideal for progressive strength and hypertrophy balance.',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  isActive: false,
  isStarter: true,
  days: [
    {
      id: 'ul-day-1',
      dayName: 'Day 1 — Upper Strength',
      dayOrder: 1,
      exercises: [
        {
          id: 'ul-ex-1',
          name: 'Barbell Bench Press',
          muscleGroup: 'Chest',
          equipment: 'barbell',
          workingSets: 3,
          repRange: '5-8',
          targetRir: 2,
          restSeconds: 150
        },
        {
          id: 'ul-ex-2',
          name: 'Barbell Bent Over Row',
          muscleGroup: 'Back',
          equipment: 'barbell',
          workingSets: 3,
          repRange: '6-10',
          targetRir: 2,
          restSeconds: 120
        },
        {
          id: 'ul-ex-3',
          name: 'Standing Overhead Barbell Press',
          muscleGroup: 'Shoulders',
          equipment: 'barbell',
          workingSets: 3,
          repRange: '6-8',
          targetRir: 2,
          restSeconds: 120
        },
        {
          id: 'ul-ex-4',
          name: 'Lat Pulldown',
          muscleGroup: 'Back',
          equipment: 'cable',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 90
        }
      ]
    },
    {
      id: 'ul-day-2',
      dayName: 'Day 2 — Lower Strength',
      dayOrder: 2,
      exercises: [
        {
          id: 'ul-ex-5',
          name: 'Barbell Back Squat',
          muscleGroup: 'Quads',
          equipment: 'barbell',
          workingSets: 3,
          repRange: '5-8',
          targetRir: 2,
          restSeconds: 150
        },
        {
          id: 'ul-ex-6',
          name: 'Romanian Deadlift (RDL)',
          muscleGroup: 'Hamstrings',
          equipment: 'barbell',
          workingSets: 3,
          repRange: '6-10',
          targetRir: 2,
          restSeconds: 120
        },
        {
          id: 'ul-ex-7',
          name: 'Leg Press',
          muscleGroup: 'Quads',
          equipment: 'machine',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 90
        },
        {
          id: 'ul-ex-8',
          name: 'Standing Calf Raise',
          muscleGroup: 'Calves',
          equipment: 'machine',
          workingSets: 4,
          repRange: '10-15',
          targetRir: 1,
          restSeconds: 60
        }
      ]
    },
    {
      id: 'ul-day-3',
      dayName: 'Day 3 — Upper Hypertrophy',
      dayOrder: 3,
      exercises: [
        {
          id: 'ul-ex-9',
          name: 'Incline Dumbbell Press',
          muscleGroup: 'Chest',
          equipment: 'dumbbell',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 90
        },
        {
          id: 'ul-ex-10',
          name: 'Seated Cable Row',
          muscleGroup: 'Back',
          equipment: 'cable',
          workingSets: 3,
          repRange: '10-12',
          targetRir: 2,
          restSeconds: 90
        },
        {
          id: 'ul-ex-11',
          name: 'Cable Lateral Raise',
          muscleGroup: 'Shoulders',
          equipment: 'cable',
          workingSets: 3,
          repRange: '12-15',
          targetRir: 1,
          restSeconds: 60
        },
        {
          id: 'ul-ex-12',
          name: 'Triceps Rope Pushdown',
          muscleGroup: 'Arms',
          equipment: 'cable',
          workingSets: 3,
          repRange: '10-15',
          targetRir: 1,
          restSeconds: 60
        },
        {
          id: 'ul-ex-13',
          name: 'Incline Dumbbell Curl',
          muscleGroup: 'Arms',
          equipment: 'dumbbell',
          workingSets: 3,
          repRange: '10-12',
          targetRir: 1,
          restSeconds: 60
        }
      ]
    },
    {
      id: 'ul-day-4',
      dayName: 'Day 4 — Lower Hypertrophy',
      dayOrder: 4,
      exercises: [
        {
          id: 'ul-ex-14',
          name: 'Bulgarian Split Squat',
          muscleGroup: 'Quads',
          equipment: 'dumbbell',
          workingSets: 3,
          repRange: '8-12',
          targetRir: 2,
          restSeconds: 90,
          isUnilateral: true
        },
        {
          id: 'ul-ex-15',
          name: 'Lying Leg Curl',
          muscleGroup: 'Hamstrings',
          equipment: 'machine',
          workingSets: 3,
          repRange: '10-15',
          targetRir: 1,
          restSeconds: 60
        },
        {
          id: 'ul-ex-16',
          name: 'Leg Extension',
          muscleGroup: 'Quads',
          equipment: 'machine',
          workingSets: 3,
          repRange: '12-15',
          targetRir: 1,
          restSeconds: 60
        },
        {
          id: 'ul-ex-17',
          name: 'Seated Calf Raise',
          muscleGroup: 'Calves',
          equipment: 'machine',
          workingSets: 4,
          repRange: '12-15',
          targetRir: 1,
          restSeconds: 60
        }
      ]
    }
  ]
};
