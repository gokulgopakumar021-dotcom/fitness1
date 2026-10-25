export interface PlateDefinition {
  weight: number;
  count: number; // count per side
  color: string;
  textColor?: string;
  diameterPercent: number; // 0.4 to 1.0 for visual rendering
}

export interface PlateResult {
  targetWeight: number;
  barWeight: number;
  perSideWeight: number;
  achievedTotalWeight: number;
  difference: number;
  platesPerSide: PlateDefinition[];
}

export interface WarmupStep {
  stepNumber: number;
  label: string;
  percentage: number;
  targetWeight: number;
  actualWeight: number;
  reps: number;
  description: string;
  platesPerSide: PlateDefinition[];
}

export const KG_PLATE_INVENTORY = [
  { weight: 25, color: '#ef4444', textColor: '#ffffff', diameterPercent: 1.0 },   // Red
  { weight: 20, color: '#3b82f6', textColor: '#ffffff', diameterPercent: 0.95 },  // Blue
  { weight: 15, color: '#eab308', textColor: '#000000', diameterPercent: 0.85 },  // Yellow
  { weight: 10, color: '#22c55e', textColor: '#ffffff', diameterPercent: 0.72 },  // Green
  { weight: 5, color: '#f8fafc', textColor: '#0f172a', diameterPercent: 0.58 },   // White
  { weight: 2.5, color: '#1e293b', textColor: '#f8fafc', diameterPercent: 0.46 }, // Black
  { weight: 1.25, color: '#94a3b8', textColor: '#0f172a', diameterPercent: 0.38 } // Chrome/Silver
];

export const LBS_PLATE_INVENTORY = [
  { weight: 45, color: '#3b82f6', textColor: '#ffffff', diameterPercent: 1.0 },   // Standard 45
  { weight: 35, color: '#eab308', textColor: '#000000', diameterPercent: 0.9 },   // 35
  { weight: 25, color: '#22c55e', textColor: '#ffffff', diameterPercent: 0.8 },   // 25
  { weight: 10, color: '#f8fafc', textColor: '#0f172a', diameterPercent: 0.65 },  // 10
  { weight: 5, color: '#1e293b', textColor: '#f8fafc', diameterPercent: 0.5 },    // 5
  { weight: 2.5, color: '#94a3b8', textColor: '#0f172a', diameterPercent: 0.4 }   // 2.5
];

/**
 * Calculates optimal plates to load per side of a barbell
 */
export function calculateBarbellPlates(
  targetWeight: number,
  barWeight: number = 20,
  unit: 'kg' | 'lbs' = 'kg',
  minIncrement: number = 2.5
): PlateResult {
  const inventory = unit === 'kg' ? KG_PLATE_INVENTORY : LBS_PLATE_INVENTORY;
  
  if (targetWeight <= barWeight) {
    return {
      targetWeight,
      barWeight,
      perSideWeight: 0,
      achievedTotalWeight: barWeight,
      difference: barWeight - targetWeight,
      platesPerSide: []
    };
  }

  let remainingPerSide = (targetWeight - barWeight) / 2;
  const platesPerSide: PlateDefinition[] = [];

  for (const plate of inventory) {
    if (remainingPerSide >= plate.weight) {
      const count = Math.floor(remainingPerSide / plate.weight);
      if (count > 0) {
        platesPerSide.push({
          weight: plate.weight,
          count,
          color: plate.color,
          textColor: plate.textColor,
          diameterPercent: plate.diameterPercent
        });
        remainingPerSide -= count * plate.weight;
        // Round to avoid floating point precision quirks
        remainingPerSide = Math.round(remainingPerSide * 100) / 100;
      }
    }
  }

  const loadedPerSide = platesPerSide.reduce((sum, p) => sum + p.weight * p.count, 0);
  const achievedTotal = barWeight + loadedPerSide * 2;

  return {
    targetWeight,
    barWeight,
    perSideWeight: loadedPerSide,
    achievedTotalWeight: achievedTotal,
    difference: Number((targetWeight - achievedTotal).toFixed(2)),
    platesPerSide
  };
}

/**
 * Generates an evidence-based 4-stage progressive warm-up ramp up to working weight
 */
export function generateWarmupRamp(
  workingWeight: number,
  barWeight: number = 20,
  unit: 'kg' | 'lbs' = 'kg',
  workingReps: number = 8
): WarmupStep[] {
  const steps: WarmupStep[] = [];

  // Step 1: Empty Bar (Mobility & Patterning)
  const emptyBarCalc = calculateBarbellPlates(barWeight, barWeight, unit);
  steps.push({
    stepNumber: 1,
    label: 'Empty Bar Patterning',
    percentage: Math.round((barWeight / Math.max(workingWeight, barWeight)) * 100),
    targetWeight: barWeight,
    actualWeight: barWeight,
    reps: 10,
    description: 'Establish groove, depth, and joint blood flow',
    platesPerSide: emptyBarCalc.platesPerSide
  });

  if (workingWeight <= barWeight) {
    return steps;
  }

  // Intermediate percentages: 50%, 70%, 85%
  const tiers = [
    { pct: 0.5, reps: 5, label: 'Submaximal Tempo', desc: 'Build movement velocity & position awareness' },
    { pct: 0.7, reps: 3, label: 'Neural Activation', desc: 'Recruit motor units without generating metabolic fatigue' },
    { pct: 0.85, reps: 1, label: 'Potentiation Primer', desc: 'Prepare CNS for heavy working load' }
  ];

  tiers.forEach((tier, idx) => {
    const rawTarget = workingWeight * tier.pct;
    // Don't duplicate if below bar
    if (rawTarget > barWeight) {
      const calc = calculateBarbellPlates(rawTarget, barWeight, unit);
      steps.push({
        stepNumber: idx + 2,
        label: tier.label,
        percentage: Math.round(tier.pct * 100),
        targetWeight: Math.round(rawTarget * 2) / 2,
        actualWeight: calc.achievedTotalWeight,
        reps: tier.reps,
        description: tier.desc,
        platesPerSide: calc.platesPerSide
      });
    }
  });

  // Final working set
  const workingCalc = calculateBarbellPlates(workingWeight, barWeight, unit);
  steps.push({
    stepNumber: steps.length + 1,
    label: 'Working Set',
    percentage: 100,
    targetWeight: workingWeight,
    actualWeight: workingCalc.achievedTotalWeight,
    reps: workingReps,
    description: 'Working protocol target load',
    platesPerSide: workingCalc.platesPerSide
  });

  return steps;
}
