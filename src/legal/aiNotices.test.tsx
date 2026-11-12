import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_NOTICES, type AiNoticeKind } from './aiNotices';
import { AiNotice } from '../components/legal/AiNotice';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const KINDS = Object.keys(AI_NOTICES) as AiNoticeKind[];

describe('AI / fitness notice wording', () => {
  it.each(KINDS)('%s is concise (not one oversized disclaimer) and makes no medical or validation claim', (k) => {
    const t = AI_NOTICES[k].text;
    expect(t.length).toBeLessThan(330);
    expect(t).not.toMatch(/clinically|medically (validated|proven|approved)|certified|diagnos(e|es|tic) (your|you)\b(?!.*not)/i);
    expect(t).not.toMatch(/guarantee(d)?\b(?!.*not)/i);
  });

  it('every notice is distinct, so no single boilerplate is pasted everywhere', () => {
    expect(new Set(KINDS.map((k) => AI_NOTICES[k].text)).size).toBe(KINDS.length);
  });

  it('required statements are covered where they apply', () => {
    const all = (ks: AiNoticeKind[]) => ks.map((k) => AI_NOTICES[k].text).join(' ');
    expect(all(['trainer', 'form', 'recovery', 'overload', 'nutrition', 'mirror'])).toMatch(/wrong|inaccura/i);
    for (const k of ['trainer', 'form', 'nutrition', 'recovery', 'bodyscan', 'physique'] as const) expect(AI_NOTICES[k].text).toMatch(/not (medical|a medical|dietetic)|medical (advice|assessment|measurements)/i);
    for (const k of ['trainer', 'mirror', 'form', 'warmup', 'overload', 'recovery'] as const) expect(AI_NOTICES[k].text).toMatch(/pain|dizz/i);
    for (const k of ['trainer', 'form', 'routine', 'nutrition', 'recovery', 'bodyscan', 'physique'] as const) expect(AI_NOTICES[k].text).toMatch(/professional|physiotherapist|dietitian|doctor|coach/i);
  });

  it('never claims Gemini/AI watches video, and never calls preset physique images AI-generated', () => {
    for (const k of KINDS) expect(AI_NOTICES[k].text).not.toMatch(/(gemini|ai)\s+(watch|sees|analy[sz]es your video|reviews your video)/i);
    expect(AI_NOTICES.mirror.text).toMatch(/on-device pose model/);
    expect(AI_NOTICES.bodyscan.text).toMatch(/on-device/);
    expect(AI_NOTICES.physique.text).toMatch(/preset illustrations, not generated/);
  });
});

describe('AiNotice component', () => {
  it('renders an accessible note with the registry text', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => root.render(<AiNotice kind="recovery" />));
    const note = el.querySelector('p[role="note"]')!;
    expect(note.getAttribute('data-ai-notice')).toBe('recovery');
    expect(note.getAttribute('aria-label')).toBe(AI_NOTICES.recovery.label);
    expect(note.textContent).toBe(AI_NOTICES.recovery.text);
    act(() => root.unmount());
    el.remove();
  });
});

/** The notice must actually be mounted in each feature the brief names (wiring check). */
describe('notices are wired into every AI feature', () => {
  const WIRING: [AiNoticeKind, string][] = [
    ['trainer', 'src/components/trainer/AiTrainerView.tsx'],
    ['trainer', 'src/components/trainer/FloatingTrainerWidget.tsx'],
    ['mirror', 'src/components/workoutMirror/WorkoutMirrorContainer.tsx'],
    ['form', 'src/components/posture/ExercisePostureModal.tsx'],
    ['warmup', 'src/components/trainer/DynamicWarmupModal.tsx'],
    ['routine', 'src/components/plans/AiRoutineBuilderModal.tsx'],
    ['nutrition', 'src/components/nutrition/NutritionView.tsx'],
    ['recovery', 'src/components/dashboard/AiRecoveryInsightsPanel.tsx'],
    ['overload', 'src/components/progression/ProgressionView.tsx'],
    ['physique', 'src/components/trainer/DreamPhysiqueModal.tsx'],
    ['bodyscan', 'src/components/bodyscan/BodyScanFlow.tsx']
  ];
  it.each(WIRING)('%s notice in %s', (kind, file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toContain(`<AiNotice kind="${kind}"`);
    expect(src).toMatch(/import \{ AiNotice \} from '.*legal\/AiNotice'/);
  });
});
