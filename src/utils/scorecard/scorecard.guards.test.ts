import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/*
 * Source-level guards for the Daily Health Scorecard. They read the files as text, so they catch a future edit that
 * quietly couples the scorecard to something it must stay independent of. Behaviour is covered by the other test files.
 */
const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), 'utf8');
/** Source with comments removed, so a word in a doc comment never trips a check. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const importsOf = (src: string) => [...src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

const ENGINE = ['src/utils/scorecard/scoring.ts', 'src/utils/scorecard/types.ts', 'src/utils/scorecard/index.ts'];
const COMPONENT = 'src/components/dashboard/DailyScorecardSection.tsx';
const ALL = [...ENGINE, COMPONENT];

describe('isolation: the scorecard stays independent of recovery analytics, Coach Iron, Body Scan, AI and storage', () => {
  const FORBIDDEN_IMPORT = /recoveryAnalytics|sleepAnalytics|trainer|bodyScan|body-scan|gemini|genai|services|storage|server|context\//i;

  it.each(ALL)('%s imports nothing from those areas', (file) => {
    const bad = importsOf(code(file)).filter((spec) => FORBIDDEN_IMPORT.test(spec));
    expect(bad).toEqual([]);
  });

  it('the engine imports only types and the Muscle Map day helpers', () => {
    const specs = importsOf(code('src/utils/scorecard/scoring.ts'));
    for (const s of specs) expect(s).toMatch(/^(\.\/types|\.\.\/\.\.\/types|\.\.\/muscleMap(\/localDay)?|\.\.\/muscleMap)$/);
  });
});

describe('local only: no network, storage, randomness or hidden clock use', () => {
  it.each(ALL)('%s uses no network or storage API', (file) => {
    expect(code(file)).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|\bdb\./);
  });

  it.each(ALL)('%s has no randomness or raw HTML injection', (file) => {
    expect(code(file)).not.toMatch(/Math\.random|dangerouslySetInnerHTML|innerHTML/);
  });

  it.each(ENGINE)('%s (pure engine) never reads the clock', (file) => {
    expect(code(file)).not.toMatch(/Date\.now\s*\(|new Date\s*\(\s*\)/);
  });

  it('the component reads the clock in one place only (an injectable default)', () => {
    const src = code(COMPONENT);
    expect(src.match(/new Date\s*\(\s*\)/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/now \?\? new Date\(\)/);
    expect(src).not.toMatch(/Date\.now\s*\(/);
  });
});

describe('themes: colours come from theme tokens, never fixed values', () => {
  const src = code(COMPONENT);

  it('has no hex, rgb/hsl or named-palette colours', () => {
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(src).not.toMatch(/\b(?:text|bg|border|ring|fill|stroke)-(?:white|black|zinc|gray|grey|slate|neutral|stone|red|green|blue|yellow|orange|emerald|sky)\b/);
  });

  it('every colour utility is one of the app theme tokens', () => {
    const colourClasses = [...src.matchAll(/\b(?:text|bg|border)-(?:\[var\(--[a-z-]+\)\]|[a-z0-9-]+(?:\/\d+)?)/g)].map((m) => m[0]);
    const sizes = /^text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|left|right|center|\[11px\])$/;
    const tokens = /^(?:text-\[var\(--text-(?:primary|secondary)\)\]|bg-surface-2|bg-accent\/10|border-line|border-accent\/30)$/;
    const stray = colourClasses.filter((c) => !sizes.test(c) && !tokens.test(c) && !/^border-(?:t|b|l|r)?$/.test(c));
    expect(stray).toEqual([]);
  });

  it('the tokens it uses are defined for both the dark default and the .light theme', () => {
    const css = read('src/index.css');
    // Anchor on the rule selectors at the start of a line (the words also appear in a comment above them).
    const rootStart = css.search(/^:root\b/m);
    const lightStart = css.search(/^\.light\b/m);
    const themeStart = css.search(/^@theme inline/m);
    expect(rootStart).toBeGreaterThanOrEqual(0);
    expect(lightStart).toBeGreaterThan(rootStart);
    expect(themeStart).toBeGreaterThan(lightStart);
    const rootBlock = css.slice(rootStart, lightStart);
    const lightBlock = css.slice(lightStart, themeStart);
    for (const v of ['--text-primary', '--text-secondary', '--bg-surface-elevated', '--border-card', '--accent']) {
      expect(rootBlock, `:root defines ${v}`).toContain(v);
      expect(lightBlock, `.light defines ${v}`).toContain(v);
    }
    for (const t of ['--color-surface-2', '--color-line', '--color-accent']) expect(css).toContain(t);
  });
});

describe('responsiveness: layout rules that keep a 320 px screen from overflowing', () => {
  const src = read(COMPONENT);

  it('stacks the cards on small screens and wraps controls and long text', () => {
    expect(src).toContain('grid grid-cols-1 md:grid-cols-2');
    expect(src).toContain('flex-wrap');
    expect(src).toContain('break-words');
    expect(src).toContain('min-w-0');
  });

  it('uses no fixed pixel widths, heights or min-widths', () => {
    expect(src).not.toMatch(/\b(?:min-|max-)?[wh]-\[\d+px\]/);
    expect(src).not.toMatch(/style=\{\{[^}]*(?:width|minWidth)\s*:\s*\d/);
  });
});
