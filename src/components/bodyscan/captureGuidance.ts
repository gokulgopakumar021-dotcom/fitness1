import type { ScanView } from '../../types/bodyScan';

export interface ViewGuidance {
  title: string;
  /** Short label, e.g. for step lists. */
  label: string;
  stepNumber: 1 | 2;
  instructions: string[];
}

/** General framing advice. It describes how to take a consistent photo; it is not a medical or fitness assessment. */
export const CAPTURE_GUIDANCE: Record<ScanView, ViewGuidance> = {
  front: {
    title: 'Front photo',
    label: 'Front',
    stepNumber: 1,
    instructions: [
      'Prop your device upright on something stable, about 2 to 3 metres away, with the lens roughly at chest to hip height.',
      'Stand facing the camera with your whole body in view, head to feet, with a little space around you.',
      'Feet about shoulder-width apart, arms slightly away from your sides, relaxed and standing tall.',
      'Wear fitted clothing, use a plain background and have the light in front of you rather than behind.',
    ],
  },
  side: {
    title: 'Side photo',
    label: 'Side',
    stepNumber: 2,
    instructions: [
      'Keep the device at the same distance and height as the front photo.',
      'Turn 90 degrees so one side faces the camera. Use the same side each time you scan.',
      'Stand tall with arms hanging naturally and look straight ahead, not at the screen.',
      'Keep your whole body in view, head to feet, in the same clothing and lighting as the front photo.',
    ],
  },
};
