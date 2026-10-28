export interface BiomechanicalCheckpoint {
  phase: 'Setup' | 'Descent' | 'Bottom / Turnaround' | 'Ascent' | 'Lockout';
  cues: string[];
  anatomicalFocus: string;
}

export interface JointAngleCheckpoint {
  joint: string;
  recommendedAngle: string;
  alignmentCue: string;
}

export interface PostureMistake {
  mistake: string;
  dangerLevel: 'high' | 'moderate';
  biomechanicalRisk: string;
  correction: string;
}

export interface ExerciseBiomechanicsData {
  id: string;
  name: string;
  aliases: string[];
  category: 'squat' | 'hinge' | 'push_horizontal' | 'push_vertical' | 'pull_vertical' | 'pull_horizontal' | 'isolation';
  diagramType: 'squat' | 'bench' | 'deadlift' | 'press' | 'row' | 'curl' | 'pulldown' | 'lateral_raise' | 'generic';
  primaryMuscles: string[];
  synergistMuscles: string[];
  stabilizerMuscles: string[];
  setupPosture: string[];
  checkpoints: BiomechanicalCheckpoint[];
  jointAngles: JointAngleCheckpoint[];
  commonMistakes: PostureMistake[];
  tempoRecommendation: string;
  breathingPattern: string;
  mobilityCheck: string;
}

export const EXERCISE_BIOMECHANICS: Record<string, ExerciseBiomechanicsData> = {
  'barbell-squat': {
    id: 'barbell-squat',
    name: 'Barbell Back Squat',
    aliases: ['Squat', 'Back Squat', 'Barbell Squat', 'High Bar Squat', 'Low Bar Squat'],
    category: 'squat',
    diagramType: 'squat',
    primaryMuscles: ['Quadriceps (Rectus Femoris, Vastus Lateralis/Medialis)', 'Gluteus Maximus'],
    synergistMuscles: ['Adductor Magnus', 'Hamstrings', 'Soleus'],
    stabilizerMuscles: ['Erector Spinae', 'Rectus Abdominis & Obliques (Bracing)', 'Upper Trapezius'],
    setupPosture: [
      'Grip barbell slightly wider than shoulder-width with wrists straight.',
      'Squeeze scapulae together to form a muscular shelf on upper traps.',
      'Unrack with both feet directly beneath the bar; take 2-3 precise walkout steps.',
      'Set stance shoulder-width apart with toes flared out 15° to 30°.'
    ],
    checkpoints: [
      {
        phase: 'Setup',
        cues: ['Tripod foot contact (heel, big toe base, pinky toe base)', 'Neutral cervical spine (eyes forward/down 10ft)'],
        anatomicalFocus: 'Rooted foot arch and scapular tightness'
      },
      {
        phase: 'Descent',
        cues: ['Break hips and knees simultaneously', 'Push knees actively outward tracking in line with toes', 'Keep chest elevated and bar path vertical over midfoot'],
        anatomicalFocus: 'Controlled eccentric tension on quads and glutes'
      },
      {
        phase: 'Bottom / Turnaround',
        cues: ['Hip crease descends slightly below top of knee patella (parallel depth)', 'Maintain rigid intra-abdominal brace; avoid pelvis tucking (butt wink)'],
        anatomicalFocus: 'Full stretch reflection with neutral lumbar spine'
      },
      {
        phase: 'Ascent',
        cues: ['Drive the floor away aggressively through midfoot', 'Chest and hips rise at identical angles without hips shooting back'],
        anatomicalFocus: 'Violent concentric quad and glute contraction'
      },
      {
        phase: 'Lockout',
        cues: ['Stand tall with glutes clenched; knees straight but not hyperextended'],
        anatomicalFocus: 'Reset breath and brace before subsequent repetition'
      }
    ],
    jointAngles: [
      { joint: 'Knee Flexion', recommendedAngle: '110° to 125°', alignmentCue: 'Knees tracking over 2nd & 3rd toes' },
      { joint: 'Hip Hinge', recommendedAngle: '80° to 95°', alignmentCue: 'Balanced over midfoot without excessive forward lean' },
      { joint: 'Ankle Dorsiflexion', recommendedAngle: '25° to 35°', alignmentCue: 'Heels glued to platform at all times' },
      { joint: 'Lumbar Spine', recommendedAngle: '0° (Neutral)', alignmentCue: 'Prevent flexion or hyperextension under compressive load' }
    ],
    commonMistakes: [
      {
        mistake: 'Knee Valgus (Knees collapsing inward during ascent)',
        dangerLevel: 'high',
        biomechanicalRisk: 'Excessive shear stress on ACL, MCL, and patellofemoral joint cartilage.',
        correction: 'Screw feet into floor creating external hip rotation torque; think "spread the floor apart".'
      },
      {
        mistake: 'Good-Morning Squat (Hips shoot up first, chest collapses forward)',
        dangerLevel: 'high',
        biomechanicalRisk: 'Dramatically increases lumbar spine shear force and torque on L4-S1.',
        correction: 'Drive upper back into the bar on turnaround; cue "chest up" and strengthen quad quadriceps drive.'
      },
      {
        mistake: 'Heels Rising Off Ground (Weight shifting onto toes)',
        dangerLevel: 'moderate',
        biomechanicalRisk: 'Disrupts vertical bar path, overloads patellar tendon.',
        correction: 'Widen stance slightly or elevate heels with lifting shoes/plates to accommodate ankle dorsiflexion.'
      }
    ],
    tempoRecommendation: '3-1-1-0 (3s controlled descent, 1s pause in the hole, explosive drive upward, 0s reset)',
    breathingPattern: 'Deep diaphragmatic inhale & 360° Valsalva brace at top -> hold breath throughout descent and turnaround -> exhale through pursed lips past sticking point.',
    mobilityCheck: 'Test 5-inch wall ankle mobility and adductor flexibility before adding heavy load.'
  },

  'barbell-bench-press': {
    id: 'barbell-bench-press',
    name: 'Barbell Bench Press',
    aliases: ['Bench Press', 'Flat Barbell Bench', 'Barbell Bench', 'Bench'],
    category: 'push_horizontal',
    diagramType: 'bench',
    primaryMuscles: ['Pectoralis Major (Sternal & Clavicular heads)', 'Anterior Deltoids'],
    synergistMuscles: ['Triceps Brachii', 'Serratus Anterior'],
    stabilizerMuscles: ['Latissimus Dorsi', 'Rotator Cuff (Infraspinatus, Teres Minor)', 'Leg Drive (Quads/Glutes)'],
    setupPosture: [
      'Eyes directly underneath the racked bar.',
      'Retract and depress shoulder blades ("tuck shoulder blades into back pockets").',
      'Arch thoracic spine while keeping buttocks and upper back pinned to bench.',
      'Plant feet flat on floor behind knees for solid leg drive.'
    ],
    checkpoints: [
      {
        phase: 'Setup',
        cues: ['Grip bar with thumbs around (suicide grip not recommended)', 'Wrists stacked directly over elbows'],
        anatomicalFocus: 'Stable shoulder capsule & wrist alignment'
      },
      {
        phase: 'Descent',
        cues: ['Tuck elbows at 45° to 75° angle relative to torso (not 90° flare)', 'Pull the bar down toward sternum like a row'],
        anatomicalFocus: 'Pec stretch with active lat engagement'
      },
      {
        phase: 'Bottom / Turnaround',
        cues: ['Touch bar gently to lower sternum/nipple line without bouncing', 'Maintain full body tension & arch'],
        anatomicalFocus: 'Maximum active pec fiber recruitment'
      },
      {
        phase: 'Ascent',
        cues: ['Press bar up and slightly back toward eye line in a subtle J-curve', 'Push heels into floor without lifting hips off bench'],
        anatomicalFocus: 'Violent chest and tricep contraction'
      },
      {
        phase: 'Lockout',
        cues: ['Lock elbows out with scapulae remaining pinned back to pad'],
        anatomicalFocus: 'Do not punch shoulders forward at top'
      }
    ],
    jointAngles: [
      { joint: 'Elbow-to-Torso Angle', recommendedAngle: '45° to 75°', alignmentCue: 'Prevents subacromial shoulder impingement' },
      { joint: 'Forearm Angle at Bottom', recommendedAngle: '90° (Vertical)', alignmentCue: 'Maximizes force vector into the bar' },
      { joint: 'Wrist Extension', recommendedAngle: '< 15°', alignmentCue: 'Stacked over radial head; no hyperextension' }
    ],
    commonMistakes: [
      {
        mistake: '90-Degree Elbow Flare ("T-Shape" benching)',
        dangerLevel: 'high',
        biomechanicalRisk: 'Pinches supraspinatus rotator cuff tendon beneath the acromion process.',
        correction: 'Tuck elbows 45-75 degrees; think "bend the bar in half" to engage lats.'
      },
      {
        mistake: 'Bouncing Bar Off Ribcage',
        dangerLevel: 'high',
        biomechanicalRisk: 'Bruised or cracked sternum, loss of muscular tension and stretch-shortening cycle integrity.',
        correction: 'Control descent for a 2-second eccentric; pause for 0.5s motionless before pressing.'
      },
      {
        mistake: 'Hips Lifting Off Bench Pad',
        dangerLevel: 'moderate',
        biomechanicalRisk: 'Disqualifies repetition and risks lumbar hyperextension sprain.',
        correction: 'Shift feet slightly forward or wider; push horizontally against the floor rather than straight up.'
      }
    ],
    tempoRecommendation: '3-0-1-0 (3s slow descent, soft sternum touch, explosive press, no linger at top)',
    breathingPattern: 'Inhale into belly and expand ribcage before descent -> hold brace -> exhale through sticking point 2/3 of the way up.',
    mobilityCheck: 'Warm up thoracic spine extension with foam roller and do band pull-aparts for rotator cuff priming.'
  },

  'deadlift': {
    id: 'deadlift',
    name: 'Conventional Barbell Deadlift',
    aliases: ['Deadlift', 'Conventional Deadlift', 'Barbell Deadlift'],
    category: 'hinge',
    diagramType: 'deadlift',
    primaryMuscles: ['Gluteus Maximus', 'Hamstrings (Biceps Femoris, Semitendinosus)', 'Quadriceps'],
    synergistMuscles: ['Erector Spinae', 'Latissimus Dorsi', 'Trapezius', 'Forearms / Grip'],
    stabilizerMuscles: ['Core (Transverse Abdominis, Obliques)', 'Rhomboids', 'Rear Deltoids'],
    setupPosture: [
      'Feet hip-width apart, bar cutting directly over midfoot (1 inch from shins).',
      'Hinge at hips without bending knees until hands reach bar just outside legs.',
      'Bend knees slightly until shins touch the barbell without moving it forward.',
      'Squeeze chest up, pull shoulder blades down ("protect armpits from tickling") to pack lats.'
    ],
    checkpoints: [
      {
        phase: 'Setup',
        cues: ['Pull the slack out of the barbell until you hear a click', 'Spine in rigid neutral from pelvis to skull'],
        anatomicalFocus: 'Pre-tensioning posterior chain before bar leaves floor'
      },
      {
        phase: 'Descent',
        cues: ['Hinge hips back while keeping bar in contact with thighs', 'Once bar clears knees, bend knees to lower plates gently to floor'],
        anatomicalFocus: 'Controlled eccentric hip hinge'
      },
      {
        phase: 'Ascent',
        cues: ['Push the floor away with legs like a leg press', 'Bar stays glued to shins and thighs throughout the pull'],
        anatomicalFocus: 'Simultaneous quad push and hip extension'
      },
      {
        phase: 'Lockout',
        cues: ['Stand tall with hips locked into bar; squeeze glutes', 'Never hyperextend lower back or lean backward'],
        anatomicalFocus: 'Neutral erect posture with engaged glutes'
      }
    ],
    jointAngles: [
      { joint: 'Hip Hinge Angle', recommendedAngle: '40° to 55°', alignmentCue: 'Hips higher than knees, lower than shoulders' },
      { joint: 'Shin Angle', recommendedAngle: '75° to 85° (Near vertical)', alignmentCue: 'Prevents kicking bar forward' },
      { joint: 'Lumbar-Pelvic Alignment', recommendedAngle: '0° (Neutral curvature)', alignmentCue: 'Zero rounding under tensile load' }
    ],
    commonMistakes: [
      {
        mistake: 'Cat-Back Lumbar Rounding (Spinal Flexion under load)',
        dangerLevel: 'high',
        biomechanicalRisk: 'Extremely high anterior disc compression and posterior disc herniation risk.',
        correction: 'Pull slack out of bar, expand belly with Valsalva brace, and lock lats down before lifting.'
      },
      {
        mistake: 'Bar Drifting Forward Away from Shins',
        dangerLevel: 'high',
        biomechanicalRisk: 'Lengthens moment arm from hips, exponentially increasing lower back strain.',
        correction: 'Keep lats engaged like a straight-arm pulldown so the barbell drags against shins and thighs.'
      },
      {
        mistake: 'Hyperextending Lumbar Spine at Lockout (Leaning back)',
        dangerLevel: 'moderate',
        biomechanicalRisk: 'Packs facet joints of vertebrae under immense compressive shear.',
        correction: 'Stop pull when knees and hips are locked straight; squeeze glutes without leaning backwards.'
      }
    ],
    tempoRecommendation: '1-0-1-1 (Explosive 1s pull, 0s pause at top, 1s controlled lower to dead stop, 1s reset)',
    breathingPattern: 'Deep brace into belly before each pull from floor. Never exhale while pulling from floor.',
    mobilityCheck: 'Ensure adequate hamstring length to reach bar without lumbar flexion.'
  },

  'overhead-press': {
    id: 'overhead-press',
    name: 'Standing Overhead Barbell Press',
    aliases: ['Overhead Press', 'OHP', 'Military Press', 'Shoulder Press'],
    category: 'push_vertical',
    diagramType: 'press',
    primaryMuscles: ['Anterior Deltoids', 'Lateral Deltoids'],
    synergistMuscles: ['Triceps Brachii', 'Upper Pectoralis', 'Serratus Anterior'],
    stabilizerMuscles: ['Gluteus Maximus', 'Rectus Abdominis', 'Trapezius (Upper & Middle)'],
    setupPosture: [
      'Grip barbell just outside shoulders with wrists stacked directly over vertical forearms.',
      'Bar rests across front deltoids and clavicle.',
      'Squeeze glutes hard and brace abs tight to prevent lower back arching.',
      'Feet shoulder-width apart firmly rooted.'
    ],
    checkpoints: [
      {
        phase: 'Setup',
        cues: ['Elbows pointing slightly forward in front of bar', 'Chest up, chin pulled back ("make a double chin")'],
        anatomicalFocus: 'Clear pathway for vertical barbell trajectory'
      },
      {
        phase: 'Ascent',
        cues: ['Press bar vertically upward in a straight line grazing the nose', 'Once bar clears forehead, push head forward through the "window"'],
        anatomicalFocus: 'Deltoid contraction and upward scapular rotation'
      },
      {
        phase: 'Lockout',
        cues: ['Bar directly aligned over base of neck, hips, and midfoot', 'Shrug upper traps slightly to support humeral head in socket'],
        anatomicalFocus: 'Serratus anterior and upper trap stabilization'
      },
      {
        phase: 'Descent',
        cues: ['Pull chin back again as bar lowers in control back to front delts', 'Keep elbows slightly forward of bar'],
        anatomicalFocus: 'Eccentric deltoid loading'
      }
    ],
    jointAngles: [
      { joint: 'Forearm Angle at Start', recommendedAngle: '90° (Vertical)', alignmentCue: 'Direct force line through the bar' },
      { joint: 'Pelvic Tilt', recommendedAngle: 'Neutral / Slight Posterior', alignmentCue: 'Glutes clenched to protect lumbar spine' },
      { joint: 'Lockout Alignment', recommendedAngle: '180° (Straight line)', alignmentCue: 'Wrist, elbow, shoulder, hip, ankle stacked' }
    ],
    commonMistakes: [
      {
        mistake: 'Excessive Lumbar Hyperextension (Turning OHP into standing incline bench)',
        dangerLevel: 'high',
        biomechanicalRisk: 'Severely compresses lumbar spine vertebrae and facet joints.',
        correction: 'Clench glutes with 100% effort and pull ribcage down before every rep.'
      },
      {
        mistake: 'Bar Looping Around Face Instead of Straight Path',
        dangerLevel: 'moderate',
        biomechanicalRisk: 'Wastes kinetic energy and increases torque on shoulder joints.',
        correction: 'Pull head back like a turtle retreating into shell to allow vertical bar path.'
      }
    ],
    tempoRecommendation: '2-0-1-0 (2s controlled descent to clavicle, explosive vertical press)',
    breathingPattern: 'Inhale & brace before press -> exhale as bar passes crown of head -> inhale at bottom or top lockout.',
    mobilityCheck: 'Test active shoulder flexion to 180° with flat back against a wall.'
  },

  'barbell-row': {
    id: 'barbell-row',
    name: 'Barbell Bent-Over Row',
    aliases: ['Barbell Row', 'Bent Over Row', 'Pendlay Row'],
    category: 'pull_horizontal',
    diagramType: 'row',
    primaryMuscles: ['Latissimus Dorsi', 'Rhomboids', 'Middle & Lower Trapezius'],
    synergistMuscles: ['Biceps Brachii', 'Brachialis', 'Posterior Deltoids'],
    stabilizerMuscles: ['Erector Spinae', 'Glutes & Hamstrings', 'Forearms / Grip'],
    setupPosture: [
      'Feet hip-width apart under bar.',
      'Hinge hips back until torso is 45° to 70° relative to floor (or parallel for Pendlay row).',
      'Neutral spine with chest proud and shoulder blades depressed.',
      'Grip bar slightly wider than shoulder width.'
    ],
    checkpoints: [
      {
        phase: 'Setup',
        cues: ['Arms hanging straight down from shoulders', 'Weight balanced over midfoot; knees slightly soft'],
        anatomicalFocus: 'Stable isometric posterior chain shelf'
      },
      {
        phase: 'Ascent',
        cues: ['Pull elbows up and back toward hips ("put elbows in back pockets")', 'Pull barbell to lower ribcage/belly button, not upper chest'],
        anatomicalFocus: 'Maximum lat contraction and scapular retraction'
      },
      {
        phase: 'Lockout',
        cues: ['Hold peak contraction for 0.5s with shoulder blades squeezed together'],
        anatomicalFocus: 'Rhomboid and mid-back hypertrophy stimulus'
      },
      {
        phase: 'Descent',
        cues: ['Lower bar with full control until arms are extended', 'Allow scapulae to protract gently under full muscular stretch'],
        anatomicalFocus: 'Eccentric stretch on lats'
      }
    ],
    jointAngles: [
      { joint: 'Torso Angle', recommendedAngle: '45° to 60°', alignmentCue: 'Maintain steady angle; no swinging' },
      { joint: 'Elbow Flare Angle', recommendedAngle: '30° to 45° for lats', alignmentCue: 'Keep elbows tucked near sides' }
    ],
    commonMistakes: [
      {
        mistake: 'Using Momentum / Torso Yanking',
        dangerLevel: 'moderate',
        biomechanicalRisk: 'Shifts load off back muscles onto lower back jerk motion.',
        correction: 'Lock torso in stone; if you must swing up, reduce weight by 20%.'
      },
      {
        mistake: 'Rounded Upper and Lower Back',
        dangerLevel: 'high',
        biomechanicalRisk: 'High lumbar shear while carrying heavy dynamic load.',
        correction: 'Stick chest out and gaze 6 feet ahead on floor to maintain cervical neutrality.'
      }
    ],
    tempoRecommendation: '2-1-1-0 (2s eccentric stretch, 1s pause at belly button, 1s pull)',
    breathingPattern: 'Inhale at bottom stretch -> hold brace -> exhale as bar touches torso.',
    mobilityCheck: 'Verify hamstring length allows 45-degree hinge without spinal flexion.'
  },

  'lat-pulldown': {
    id: 'lat-pulldown',
    name: 'Cable Lat Pulldown',
    aliases: ['Lat Pulldown', 'Pulldown', 'Wide Grip Pulldown', 'Cable Pulldown'],
    category: 'pull_vertical',
    diagramType: 'pulldown',
    primaryMuscles: ['Latissimus Dorsi', 'Teres Major'],
    synergistMuscles: ['Biceps Brachii', 'Brachialis', 'Lower Trapezius', 'Rear Delts'],
    stabilizerMuscles: ['Forearms', 'Core'],
    setupPosture: [
      'Adjust thigh pad snug against tops of thighs to prevent rising.',
      'Grip bar slightly wider than shoulder-width with thumbless or standard grip.',
      'Slight 10-15° thoracic extension lean back.',
      'Depress scapulae down before pulling.'
    ],
    checkpoints: [
      {
        phase: 'Setup',
        cues: ['Full stretch at top with arms straight and lats lengthened', 'Chest elevated'],
        anatomicalFocus: 'Maximum lat stretch under tension'
      },
      {
        phase: 'Ascent',
        cues: ['Drive elbows straight down and slightly back toward hips', 'Pull bar smoothly to upper chest/collarbone line'],
        anatomicalFocus: 'Lat shortening and scapular downward rotation'
      },
      {
        phase: 'Lockout',
        cues: ['Squeeze lats for 1 second at collarbone; do not yank behind neck'],
        anatomicalFocus: 'Peak contraction'
      },
      {
        phase: 'Descent',
        cues: ['Resist the cable for 3 seconds all the way to full arm extension', 'Allow shoulder blades to elevate naturally at top'],
        anatomicalFocus: 'Full eccentric muscle remodeling'
      }
    ],
    jointAngles: [
      { joint: 'Torso Incline', recommendedAngle: '10° to 15° backward', alignmentCue: 'Keeps cable path in plane of lats' },
      { joint: 'Elbow Path', recommendedAngle: 'In frontal plane toward ribs', alignmentCue: 'Avoid flaring elbows back behind torso' }
    ],
    commonMistakes: [
      {
        mistake: 'Pulling Bar Behind Neck',
        dangerLevel: 'high',
        biomechanicalRisk: 'Forces excessive forward head tilt and extreme external rotation, damaging rotator cuff and cervical vertebrae.',
        correction: 'Always pull to front clavicle; lean back 10 degrees to clear face cleanly.'
      },
      {
        mistake: 'Leaning Back 45° to Turn into a Row',
        dangerLevel: 'moderate',
        biomechanicalRisk: 'Takes focus off vertical lat fibers onto rear delts and mid-traps.',
        correction: 'Keep torso stationary; only move arms and scapulae.'
      }
    ],
    tempoRecommendation: '3-1-1-0 (3s slow eccentric return, 1s hard squeeze at collarbone, 1s pull)',
    breathingPattern: 'Inhale on the reach up; exhale as you drive elbows down to chest.',
    mobilityCheck: 'Check lat flexibility to ensure full overhead reach without arching lower back.'
  },

  'romanian-deadlift': {
    id: 'romanian-deadlift',
    name: 'Romanian Deadlift (RDL)',
    aliases: ['RDL', 'Barbell RDL', 'Dumbbell RDL', 'Romanian Deadlift'],
    category: 'hinge',
    diagramType: 'deadlift',
    primaryMuscles: ['Hamstrings (Semitendinosus, Biceps Femoris)', 'Gluteus Maximus'],
    synergistMuscles: ['Adductor Magnus', 'Erector Spinae'],
    stabilizerMuscles: ['Latissimus Dorsi', 'Upper Back', 'Core'],
    setupPosture: [
      'Unrack barbell from standing position or deadlift up.',
      'Feet hip-width apart with toes pointing forward.',
      'Slight 15° knee bend (soft knees) that remains locked in place.',
      'Shoulder blades pinned back, lats engaged keeping bar glued to thighs.'
    ],
    checkpoints: [
      {
        phase: 'Setup',
        cues: ['Stand tall with neutral pelvis', 'Lats tight, bar touching front of thighs'],
        anatomicalFocus: 'Neutral spinal posture'
      },
      {
        phase: 'Descent',
        cues: ['Push hips straight back like trying to touch a wall behind you with tailbone', 'Knees stay soft but do not bend further (this is a hinge, not a squat)', 'Bar tracks against thighs down to just below knees/mid-shin'],
        anatomicalFocus: 'Intense stretch in hamstrings and glutes'
      },
      {
        phase: 'Bottom / Turnaround',
        cues: ['Stop descent when hamstrings reach maximum active stretch or before lower back rounds', 'Pause for 1 second in the stretch position'],
        anatomicalFocus: 'Loaded stretch hypertrophy stimulus'
      },
      {
        phase: 'Ascent',
        cues: ['Drive hips forward by contracting glutes and hamstrings', 'Keep bar glued to thighs on way up'],
        anatomicalFocus: 'Hip extension'
      }
    ],
    jointAngles: [
      { joint: 'Knee Angle', recommendedAngle: '15° to 20° (Fixed soft knee)', alignmentCue: 'Static knee joint; all motion is at hip' },
      { joint: 'Hip Hinge Angle', recommendedAngle: '70° to 90°', alignmentCue: 'Hips push back as far as possible' }
    ],
    commonMistakes: [
      {
        mistake: 'Squatting the Weight (Bending knees excessively during descent)',
        dangerLevel: 'moderate',
        biomechanicalRisk: 'Removes tension from hamstrings and shifts it to quads.',
        correction: 'Keep shins perpendicular to floor; focus on pushing hips backwards horizontally.'
      },
      {
        mistake: 'Reaching for the Floor with Arms and Rounding Spine',
        dangerLevel: 'high',
        biomechanicalRisk: 'High disc herniation risk under stretch tension.',
        correction: 'Depth is determined by hip range of motion, not floor contact. Stop when hips stop moving back.'
      }
    ],
    tempoRecommendation: '3-1-1-0 (3s slow eccentric stretch, 1s loaded stretch pause, 1s powerful hip drive)',
    breathingPattern: 'Inhale & brace at top -> descend holding brace -> exhale at lockout as hips extend.',
    mobilityCheck: 'Test active straight leg raise and hamstring elasticity.'
  },

  'cable-lateral-raise': {
    id: 'cable-lateral-raise',
    name: 'Cable Lateral Raise',
    aliases: ['Lateral Raise', 'Dumbbell Lateral Raise', 'Cable Lateral', 'Side Lateral'],
    category: 'isolation',
    diagramType: 'lateral_raise',
    primaryMuscles: ['Lateral Deltoids (Middle Head)'],
    synergistMuscles: ['Supraspinatus', 'Anterior & Posterior Deltoids'],
    stabilizerMuscles: ['Trapezius', 'Core & Obliques'],
    setupPosture: [
      'Set cable pulley at wrist or mid-shin height for continuous tension.',
      'Stand perpendicular or slightly forward of cable column.',
      'Slight 15° forward torso tilt.',
      'Grip handle with thumb wrapped; slight bend in elbow (10-15°).'
    ],
    checkpoints: [
      {
        phase: 'Setup',
        cues: ['Arm crossing body in front or behind with cable under tension', 'Shoulders relaxed and depressed'],
        anatomicalFocus: 'Lateral delt loaded in stretched position'
      },
      {
        phase: 'Ascent',
        cues: ['Raise arm outward in the scapular plane (30° forward of straight lateral)', 'Lead with elbows and back of the hand, not thumb', 'Raise to shoulder height (parallel to floor)'],
        anatomicalFocus: 'Pure middle deltoid abduction'
      },
      {
        phase: 'Lockout',
        cues: ['Hold peak contraction for 1 second at shoulder level', 'Keep neck relaxed and traps down'],
        anatomicalFocus: 'Peak muscle fiber shortening'
      },
      {
        phase: 'Descent',
        cues: ['Control descent for 3 seconds fighting the cable pull all the way to start'],
        anatomicalFocus: 'Eccentric damage to lateral delt'
      }
    ],
    jointAngles: [
      { joint: 'Scapular Plane Angle', recommendedAngle: '30° forward of torso', alignmentCue: 'Clears supraspinatus tendon from impingement' },
      { joint: 'Elbow Flexion', recommendedAngle: '10° to 15° (Soft fixed elbow)', alignmentCue: 'Do not bend or extend elbow during repetition' }
    ],
    commonMistakes: [
      {
        mistake: 'Shrugging with Upper Trapezius',
        dangerLevel: 'moderate',
        biomechanicalRisk: 'Traps take over movement, minimizing lateral deltoid growth.',
        correction: 'Depress shoulders down; imagine reaching knuckles toward far walls rather than pulling up.'
      },
      {
        mistake: 'Swinging Body / Momentum',
        dangerLevel: 'moderate',
        biomechanicalRisk: 'Reduces time under tension for small muscle group.',
        correction: 'Stand tall with core tight, or hold the cable upright pillar with free hand.'
      }
    ],
    tempoRecommendation: '3-1-1-0 (3s slow descent, 1s peak contraction hold, 1s lift)',
    breathingPattern: 'Exhale smoothly as you raise arm; inhale as you lower the cable.',
    mobilityCheck: 'Warm up rotator cuff with external rotations before heavy deltoid work.'
  }
};

/** Shown wherever a form guide would be, when no verified guide exists for the exercise. */
export const NO_BIOMECHANICS_GUIDE_MESSAGE = 'No form guide available for this exercise.';

export type BiomechanicsMatchSource = 'key' | 'name' | 'alias';

/**
 * Result of a biomechanics lookup. A guide is returned ONLY for an exact, verified match. There is deliberately no
 * fallback: a wrong form guide (for example squat cues on a face pull) is worse than none.
 */
export type BiomechanicsLookup =
  | { status: 'match'; key: string; matchedBy: BiomechanicsMatchSource; data: ExerciseBiomechanicsData }
  | { status: 'no_match'; reason: 'empty' | 'unknown' | 'ambiguous' };

/**
 * Aliases that exist on an entry (and feed the video matcher, which is unchanged) but whose guide describes
 * DIFFERENT equipment, so they are not trusted for form guidance. Compared after normalisation.
 *  - 'Dumbbell Lateral Raise': the guide is the cable version (cable pulley setup, cable tension cues).
 *  - 'Dumbbell RDL': the guide is the barbell version (unrack the bar, bar tracks the thighs).
 */
const UNVERIFIED_GUIDE_ALIASES: readonly string[] = ['dumbbell lateral raise', 'dumbbell rdl'];

/** Lowercase, punctuation and hyphens become single spaces: "Pull-up" and "pull up" are the same text. */
export function normalizeExerciseLookupText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

interface LookupCandidate { key: string; matchedBy: BiomechanicsMatchSource }
let lookupIndex: Map<string, LookupCandidate[]> | null = null;

function getLookupIndex(): Map<string, LookupCandidate[]> {
  if (lookupIndex) return lookupIndex;
  const index = new Map<string, LookupCandidate[]>();
  const add = (text: string, key: string, matchedBy: BiomechanicsMatchSource) => {
    const norm = normalizeExerciseLookupText(text);
    if (!norm) return;
    const list = index.get(norm) ?? [];
    if (!list.some((c) => c.key === key)) list.push({ key, matchedBy });
    index.set(norm, list);
  };
  for (const [key, data] of Object.entries(EXERCISE_BIOMECHANICS)) {
    add(key, key, 'key');
    add(data.name, key, 'name');
    for (const alias of data.aliases) {
      if (UNVERIFIED_GUIDE_ALIASES.includes(normalizeExerciseLookupText(alias))) continue;
      add(alias, key, 'alias');
    }
  }
  lookupIndex = index;
  return index;
}

/**
 * Matches an exercise name to the biomechanics database by EXACT normalised key, canonical name or verified alias.
 * No substring or movement-pattern matching: "Front Squat", "Romanian Deadlift" and "Pull-up" must never pick up the
 * guide of a different exercise or equipment variant. Anything else (custom exercises, look-alikes) is `no_match`.
 */
export function getBiomechanicsForExercise(exerciseName: string): BiomechanicsLookup {
  const norm = typeof exerciseName === 'string' ? normalizeExerciseLookupText(exerciseName) : '';
  if (!norm) return { status: 'no_match', reason: 'empty' };
  const candidates = getLookupIndex().get(norm);
  if (!candidates) return { status: 'no_match', reason: 'unknown' };
  if (candidates.length > 1) return { status: 'no_match', reason: 'ambiguous' };
  const { key, matchedBy } = candidates[0];
  return { status: 'match', key, matchedBy, data: EXERCISE_BIOMECHANICS[key] };
}
