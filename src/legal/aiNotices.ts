/**
 * Short, feature-specific AI / fitness notices (Stage 2B). One concise line or two per feature, not one oversized
 * disclaimer everywhere. Wording rules, enforced in aiNotices.test.ts:
 *  - never say Gemini (or any AI) "watches" video or analyses camera frames: Workout Mirror runs an on-device pose model
 *    and Body Scan photos stay on the device;
 *  - never say the physique reference images are AI-generated (they are preset images);
 *  - never claim medical, clinical or diagnostic ability.
 * Draft wording: subject to the owner's and counsel's review like the rest of docs/legal.
 */
export type AiNoticeKind =
  | 'trainer'
  | 'mirror'
  | 'form'
  | 'warmup'
  | 'routine'
  | 'nutrition'
  | 'recovery'
  | 'overload'
  | 'physique'
  | 'bodyscan';

const STOP = 'Stop and seek help if you feel pain, dizziness or anything concerning.';

export const AI_NOTICES: Record<AiNoticeKind, { label: string; text: string }> = {
  trainer: {
    label: 'About AI Trainer replies',
    text: `AI replies can be wrong or incomplete. They are general fitness information, not medical advice, and do not diagnose or treat anything. Check with a qualified professional when unsure. ${STOP}`
  },
  mirror: {
    label: 'About Workout Mirror feedback',
    text: `Workout Mirror gives approximate feedback from an on-device pose model using your camera. It can be wrong and is not a coach or a medical assessment. ${STOP}`
  },
  form: {
    label: 'About form guidance',
    text: `Form guidance, including AI Form Coach answers, is informational and can be inaccurate. It is not medical advice and does not diagnose or treat injuries. Ask a qualified coach or physiotherapist if unsure. ${STOP}`
  },
  warmup: {
    label: 'About the AI warm-up',
    text: `This warm-up is AI-generated general guidance and may not suit you. Skip anything that hurts or feels wrong for your body. ${STOP}`
  },
  routine: {
    label: 'About AI-built routines',
    text: 'AI-built routines can be wrong and are not tailored by a professional. Review the exercises, loads and volume before you use them, and check with a qualified coach or doctor if you have an injury or health condition.'
  },
  nutrition: {
    label: 'About AI food analysis',
    text: 'Food analysis and nutrition targets are estimates and can be wrong. They are general information, not medical or dietetic advice. Speak to a doctor or registered dietitian if you have a medical condition or special dietary needs.'
  },
  recovery: {
    label: 'About recovery insights',
    text: 'Recovery insights are AI-assisted estimates from the sessions you logged. They can be wrong and are not a medical assessment. Persistent pain, dizziness or unusual symptoms need a qualified professional.'
  },
  overload: {
    label: 'About overload suggestions',
    text: 'Load and rep suggestions, including AI-optimised ones, are informational and can be wrong. Use your own judgement and stop a set if you feel pain or lose control of your form.'
  },
  physique: {
    label: 'About physique analysis',
    text: 'Physique blueprints are AI-generated estimates, not predictions or guarantees. Calorie, protein and timeline figures are not medical advice. The reference physique images are preset illustrations, not generated for you. Consult a professional before big diet or training changes.'
  },
  bodyscan: {
    label: 'About Body Scan',
    text: 'Body Scan gives approximate on-device estimates from photos, not medical measurements. It does not diagnose or treat anything. Talk to a qualified professional about body composition or health concerns.'
  }
};
