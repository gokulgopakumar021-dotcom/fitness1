/**
 * IL-03 regression guard: no production code may touch a localStorage key that bypasses the per-account scope.
 *
 * Every localStorage.getItem / setItem / removeItem call in src/ (tests excluded) must take its key from one of:
 *   - scopedKey(...)                      (storageScope.ts)
 *   - STORAGE_KEYS.<NAME>                 (db.ts: getters that return scopedKey(BASE_KEYS[name]); verified below)
 *   - consentKey()                        (bodyScanConsent.ts: defined as scopedKey(...); verified below)
 *   - a key returned by keysInCurrentScope() (reset / erase loops; the variable `k`)
 *   - an entry in DEVICE_LEVEL_ALLOWLIST  (exact file + key; each needs a written reason)
 * Anything else (a string literal, a bare constant, a template string) fails the test, as do sessionStorage,
 * localStorage[...] indexing and localStorage.clear(), which cannot be scoped.
 *
 * The scanner is itself tested against synthetic bypasses so a weakened scanner cannot pass silently.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** Device-level (not per-account) keys that are deliberately unscoped. Keep this list short and justified. */
const DEVICE_LEVEL_ALLOWLIST: ReadonlyArray<{ file: string; keyExpr: string; reason: string }> = [
  {
    file: 'src/sync/deviceStorage.ts',
    keyExpr: 'key',
    reason: 'Raw Storage bridge for the sync layer. Every key it receives is already account-scoped (scopedKeyFor); clear() is unsupported.'
  },
  {
    file: 'src/storage/legacyData.ts',
    keyExpr: 'legacyKey',
    reason: 'READ-ONLY access to the pre-account unscoped workout keys, used only by the explicit legacy-data claim. Never written or removed (pinned below).'
  },
  {
    file: 'src/context/ThemeContext.tsx',
    keyExpr: 'THEME_STORAGE_KEY',
    reason: 'Light/dark UI preference only; no personal data. Must apply before sign-in (login screen). Not cleared by account erase.'
  }
];

/**
 * sessionStorage stays BANNED everywhere except these exact (file, key) pairs. The general rule is unchanged: it cannot be scoped
 * or erased by account scope, so a new use must be argued for here, with a written reason. Each entry is checked for staleness below.
 */
const SESSION_STORAGE_ALLOWLIST: ReadonlyArray<{ file: string; keyExpr: string; reason: string }> = [
  {
    file: 'src/legal/policyAcceptance.ts',
    keyExpr: 'POLICY_NOTICE_SNOOZE_KEY',
    reason:
      '"Remind me later" on the existing-user policy notice. Deliberately SESSION-ONLY so it returns in a new session. Holds only the user id and the two policy version labels; no personal data, no content. It hides a notice and is not a legal acceptance.'
  }
];

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

/** Returns the first argument text of the call whose "(" is at `open`, balancing nested parentheses. */
function firstArg(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return code.slice(open + 1, i).trim();
    } else if (c === ',' && depth === 1) return code.slice(open + 1, i).trim();
  }
  return code.slice(open + 1).trim();
}

export interface Violation { file: string; problem: string }

/** Scans one production source file and reports every localStorage use that is not scoped. */
export function scanSource(file: string, source: string): Violation[] {
  const code = stripComments(source);
  const out: Violation[] = [];

  const sessionUses = [...code.matchAll(/\bsessionStorage\b/g)];
  const sessionAllowed = SESSION_STORAGE_ALLOWLIST.filter((a) => a.file === file);
  if (sessionUses.length > 0 && sessionAllowed.length === 0) {
    out.push({ file, problem: 'sessionStorage (cannot be scoped or erased by scope)' });
  } else if (sessionUses.length > 0) {
    // An allow-listed file may use sessionStorage ONLY as sessionStorage.get/set/removeItem(<its allow-listed key>).
    // Anything else (clear(), indexing, aliasing, window.sessionStorage, another key) is still a violation.
    const calls = [...code.matchAll(/(?<![.\w])sessionStorage\.(getItem|setItem|removeItem)\s*\(/g)];
    for (const m of calls) {
      const arg = firstArg(code, m.index! + m[0].length - 1);
      if (!sessionAllowed.some((a) => a.keyExpr === arg)) out.push({ file, problem: `sessionStorage.${m[1]}(${arg}) is not an allow-listed session key` });
    }
    if (calls.length !== sessionUses.length) out.push({ file, problem: 'sessionStorage used other than as an allow-listed get/set/removeItem call (alias, clear(), indexing or window.sessionStorage)' });
  }
  if (/\blocalStorage\s*\[/.test(code)) out.push({ file, problem: 'localStorage[...] indexing' });
  if (/\blocalStorage\.clear\s*\(/.test(code)) out.push({ file, problem: 'localStorage.clear() (ignores account scope)' });
  if (/\bwindow\.localStorage\b|\bglobalThis\.localStorage\b/.test(code)) {
    out.push({ file, problem: 'localStorage aliased through window/globalThis (scanner cannot follow it)' });
  }
  // Any other use of the bare identifier (`const s = localStorage`, passing it to a function, destructuring) would hide
  // calls from this scanner. Only the member accesses it understands (plus .key/.length for iteration) are allowed.
  const strings = code.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
  for (const m of strings.matchAll(/\blocalStorage\b(?!\s*\.\s*(getItem|setItem|removeItem|key|length)\b)/g)) {
    const after = strings.slice(m.index!, m.index! + 40).replace(/\s+/g, ' ');
    if (/^localStorage\.clear|^localStorage\s*\[/.test(after)) continue; // reported above
    if (/^localStorage\s*\.\s*(getItem|setItem|removeItem)/.test(after)) continue;
    out.push({ file, problem: `bare localStorage reference: ${after.trim()}` });
  }

  for (const m of code.matchAll(/\blocalStorage\.(getItem|setItem|removeItem)\s*\(/g)) {
    const arg = firstArg(code, m.index! + m[0].length - 1);
    const scoped =
      /^scopedKey\s*\(/.test(arg) ||
      /^STORAGE_KEYS\.[A-Z_]+$/.test(arg) ||
      arg === 'consentKey()' ||
      (arg === 'k' && /keysInCurrentScope\s*\(\s*\)/.test(code)) ||
      (arg === 'key' && file === 'src/storage/db.ts') ||
      DEVICE_LEVEL_ALLOWLIST.some((a) => a.file === file && a.keyExpr === arg);
    if (!scoped) out.push({ file, problem: `localStorage.${m[1]}(${arg}) is not routed through scopedKey()` });
  }
  return out;
}

const productionSources = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) out.push(relative(ROOT, full).split('\\').join('/'));
    }
  };
  walk(SRC);
  return out;
};

describe('IL-03 guard: localStorage keys cannot bypass the account scope', () => {
  it('scans the real source tree (not an empty set)', () => {
    const files = productionSources();
    expect(files.length).toBeGreaterThan(100);
    for (const must of [
      'src/storage/db.ts',
      'src/storage/storageScope.ts',
      'src/components/nutrition/WaterIntakeLogger.tsx',
      'src/components/nutrition/HydrationPacingAlert.tsx',
      'src/components/nutrition/SmartAlertsConfigModal.tsx'
    ]) expect(files).toContain(must);
  });

  it('no production file touches localStorage with an unscoped key', () => {
    const violations = productionSources().flatMap((f) => scanSource(f, readFileSync(join(ROOT, f), 'utf8')));
    expect(violations).toEqual([]);
  });

  it('the four IL-03 keys are only ever used through scopedKey()', () => {
    const files = [
      'src/components/nutrition/HydrationPacingAlert.tsx',
      'src/components/nutrition/SmartAlertsConfigModal.tsx',
      'src/components/nutrition/WaterIntakeLogger.tsx'
    ];
    const names = ['ironlog_hydration_pacing_reminders_v1', 'ironlog_last_hydration_alert_ts_v1', 'ironlog_smart_hydration_alerts_v1', 'ironlog_water_unit'];
    const calls = files.flatMap((f) => {
      const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
      return [...code.matchAll(/\blocalStorage\.(getItem|setItem|removeItem)\s*\(/g)].map((m) => firstArg(code, m.index! + m[0].length - 1));
    });
    expect(calls.length).toBe(8); // pacing 2 + last-alert 2 + smart-alerts 2 + water-unit 2; guards against scanning nothing
    expect(calls.every((a) => a.startsWith('scopedKey('))).toBe(true);
    // and none of the four names is ever passed as a bare literal
    for (const f of files) {
      const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
      for (const n of names) expect(code).not.toMatch(new RegExp(`localStorage\\.\\w+Item\\(\\s*['"\`]${n}`));
    }
  });

  it('the helpers the allow-rules trust really are scoped', () => {
    const db = readFileSync(join(ROOT, 'src/storage/db.ts'), 'utf8');
    expect(db).toMatch(/get:\s*\(\)\s*=>\s*scopedKey\(BASE_KEYS\[name\]\)/);
    const consent = readFileSync(join(ROOT, 'src/storage/bodyScanConsent.ts'), 'utf8');
    expect(consent).toMatch(/const consentKey = \(\) => scopedKey\(/);
    for (const f of ['src/storage/resetAll.ts', 'src/storage/db.ts']) {
      expect(readFileSync(join(ROOT, f), 'utf8')).toMatch(/for \(const k of keysInCurrentScope\(\)\) localStorage\.removeItem\(k\)/);
    }
  });

  it('the legacy-data reader only ever READS unscoped keys and the sync bridge never bypasses scope', () => {
    const legacy = stripComments(readFileSync(join(ROOT, 'src/storage/legacyData.ts'), 'utf8'));
    expect(legacy).not.toMatch(/localStorage\.(setItem|removeItem)\s*\(\s*legacyKey/);
    expect([...legacy.matchAll(/localStorage\.getItem\(\s*legacyKey\s*\)/g)]).toHaveLength(1);
    const bridge = stripComments(readFileSync(join(ROOT, 'src/sync/deviceStorage.ts'), 'utf8'));
    expect(bridge).not.toMatch(/localStorage\.clear/);
  });

  it('every allow-list entry is still needed and still matches (no stale or widened exceptions)', () => {
    for (const a of DEVICE_LEVEL_ALLOWLIST) {
      const code = stripComments(readFileSync(join(ROOT, a.file), 'utf8'));
      expect(code, a.file).toMatch(new RegExp(`localStorage\\.(get|set)Item\\(\\s*${a.keyExpr}\\b`));
      expect(a.reason.length).toBeGreaterThan(20);
    }
  });

  it('every sessionStorage allow-list entry is exact, still needed, justified, and the stored value holds only a user id and policy versions', () => {
    expect(SESSION_STORAGE_ALLOWLIST).toHaveLength(1); // widening this list is a deliberate, reviewed change
    for (const a of SESSION_STORAGE_ALLOWLIST) {
      const code = stripComments(readFileSync(join(ROOT, a.file), 'utf8'));
      expect(code, a.file).toMatch(new RegExp(`sessionStorage\\.getItem\\(\\s*${a.keyExpr}\\s*\\)`));
      expect(code, a.file).toMatch(new RegExp(`sessionStorage\\.setItem\\(\\s*${a.keyExpr}\\s*,`));
      expect(a.reason.length).toBeGreaterThan(20);
      expect(code, 'the snooze file must not use localStorage at all').not.toMatch(/\blocalStorage\b/);
      expect(code).toMatch(/const snoozeValue = \(userId: string, v: PolicyVersions\) => `\$\{userId\}\|\$\{v\.termsVersion\}\|\$\{v\.privacyVersion\}`;/);
    }
  });

  describe('the scanner itself catches bypasses (self-test)', () => {
    const bad: Array<[string, string]> = [
      ['string literal key', "localStorage.getItem('ironlog_water_unit');"],
      ['bare constant key', "const K='x'; localStorage.setItem(K, '1');"],
      ['template key', 'localStorage.setItem(`ironlog_${id}`, v);'],
      ['removeItem with literal', "localStorage.removeItem('ironlog_x');"],
      ['scopedKey only in the value', "localStorage.setItem('k', scopedKey('v'));"],
      ['sessionStorage', "sessionStorage.setItem('a','b');"],
      ['index access', "localStorage['ironlog_x'] = '1';"],
      ['clear()', 'localStorage.clear();'],
      ['alias variable', "const s = localStorage; s.setItem('ironlog_x', '1');"],
      ['passed as argument', 'persist(localStorage, k);'],
      ['window alias', "window.localStorage.getItem('x');"],
      ['unlisted file using the theme key', 'localStorage.getItem(THEME_STORAGE_KEY);'],
      ['the snooze key from a file that is NOT allow-listed', 'sessionStorage.setItem(POLICY_NOTICE_SNOOZE_KEY, v);']
    ];
    for (const [label, src] of bad) {
      it(`flags: ${label}`, () => expect(scanSource('src/x/y.ts', src).length).toBeGreaterThan(0));
    }
    const SNOOZE_FILE = 'src/legal/policyAcceptance.ts';
    const badInSnoozeFile: Array<[string, string]> = [
      ['a different sessionStorage key', "sessionStorage.setItem('other_key', v);"],
      ['a literal key', "sessionStorage.getItem('ironlog_policy_notice_snoozed');"],
      ['sessionStorage.clear()', 'sessionStorage.clear();'],
      ['sessionStorage indexing', "sessionStorage['a'] = 'b';"],
      ['an alias', 'const s = sessionStorage; s.setItem(POLICY_NOTICE_SNOOZE_KEY, v);'],
      ['window.sessionStorage', 'window.sessionStorage.setItem(POLICY_NOTICE_SNOOZE_KEY, v);'],
      ['passed as an argument', 'persist(sessionStorage, POLICY_NOTICE_SNOOZE_KEY);'],
      ['localStorage with the snooze key (the exception covers sessionStorage only)', 'localStorage.setItem(POLICY_NOTICE_SNOOZE_KEY, v);'],
      ['an unscoped localStorage key', "localStorage.setItem('k', v);"]
    ];
    for (const [label, src] of badInSnoozeFile) {
      it(`flags, even in the allow-listed snooze file: ${label}`, () => expect(scanSource(SNOOZE_FILE, src).length).toBeGreaterThan(0));
    }
    it('accepts exactly the snooze key calls in exactly the snooze file', () => {
      const ok = 'sessionStorage.getItem(POLICY_NOTICE_SNOOZE_KEY) === x; sessionStorage.setItem(POLICY_NOTICE_SNOOZE_KEY, v); sessionStorage.removeItem(POLICY_NOTICE_SNOOZE_KEY);';
      expect(scanSource(SNOOZE_FILE, ok)).toEqual([]);
      expect(scanSource('src/legal/other.ts', ok).length).toBeGreaterThan(0);
    });
    const good: Array<[string, string]> = [
      ['scopedKey direct', "localStorage.getItem(scopedKey('a'));"],
      ['scopedKey with constant', 'localStorage.setItem(scopedKey(KEY), v);'],
      ['nested call arg', "localStorage.setItem(scopedKey(buildKey('a', 1)), v);"],
      ['commented-out bypass', "// localStorage.getItem('x')\nlocalStorage.getItem(scopedKey('a'));"],
      ['the word in a string', "const m = 'localStorage is full'; localStorage.getItem(scopedKey('a'));"],
      ['iteration helpers', 'for (let i = 0; i < localStorage.length; i++) localStorage.key(i);']
    ];
    for (const [label, src] of good) {
      it(`accepts: ${label}`, () => expect(scanSource('src/x/y.ts', src)).toEqual([]));
    }
  });
});
