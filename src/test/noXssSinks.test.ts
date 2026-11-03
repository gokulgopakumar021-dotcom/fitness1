// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * IL-07 (web). The Supabase session is kept in localStorage (`persistSession: true`, supabase-js default), which any
 * script running in the page could read. On the web that is accepted because of two mitigations: a strict production
 * CSP (script-src 'self' 'wasm-unsafe-eval'; tested in src/server/security/security.test.ts) and NO DOM/script injection
 * sinks in production code. This tripwire protects the second one: it fails if production code under src/ starts using
 * dangerouslySetInnerHTML, innerHTML/outerHTML, insertAdjacentHTML, document.write, eval or new Function.
 *
 * It is a static text scan, not a proof: it cannot see third-party libraries, computed property access
 * (`el['inner' + 'HTML']`) or sinks reached through other modules. A real use of a sink needs a code review and, if
 * accepted, an explicit entry in ALLOWED below with a written reason.
 */
const SRC = join(process.cwd(), 'src');

/** Exact file + sink exceptions. Empty on purpose; each entry needs a reason. */
const ALLOWED: ReadonlyArray<{ file: string; sink: string; reason: string }> = [];

const SINKS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'dangerouslySetInnerHTML', re: /\bdangerouslySetInnerHTML\b/ },
  { name: 'innerHTML', re: /\.\s*innerHTML\b/ },
  { name: 'outerHTML', re: /\.\s*outerHTML\b/ },
  { name: 'insertAdjacentHTML', re: /\binsertAdjacentHTML\s*\(/ },
  { name: 'document.write', re: /\bdocument\s*\.\s*write(ln)?\s*\(/ },
  { name: 'eval', re: /(^|[^.\w$])eval\s*\(/ },
  { name: 'new Function', re: /\bnew\s+Function\s*\(/ }
];

const stripComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const findSinks = (code: string): string[] => SINKS.filter((s) => s.re.test(stripComments(code))).map((s) => s.name);

const isTestFile = (rel: string) => /\.(test|spec)\.[tj]sx?$/.test(rel) || rel.startsWith('src/test/');
function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return productionFiles(p);
    const rel = relative(process.cwd(), p).split('\\').join('/');
    return /\.(ts|tsx|js|jsx)$/.test(name) && !isTestFile(rel) ? [rel] : [];
  });
}

describe('IL-07 no DOM/script injection sinks in production code', () => {
  it('the scanner flags every sink and ignores comments and look-alikes (so a weakened scanner cannot pass silently)', () => {
    const bad: Array<[string, string]> = [
      ['<div dangerouslySetInnerHTML={{ __html: x }} />', 'dangerouslySetInnerHTML'],
      ['el.innerHTML = x;', 'innerHTML'],
      ['const h = el .innerHTML;', 'innerHTML'],
      ['el.outerHTML = x', 'outerHTML'],
      ["el.insertAdjacentHTML('beforeend', x)", 'insertAdjacentHTML'],
      ['document.write(x)', 'document.write'],
      ['document . writeln(x)', 'document.write'],
      ['eval(code)', 'eval'],
      ['x = eval ("1")', 'eval'],
      ['const f = new Function("return 1")', 'new Function']
    ];
    for (const [code, sink] of bad) expect(findSinks(code), code).toContain(sink);
    const fine = [
      '// el.innerHTML = x',
      '/* dangerouslySetInnerHTML eval(x) */',
      'const retrieval = 1; retrieval(2);',
      'model.eval()', // a method called eval on something else (e.g. a ML model) is not the global eval
      'el.textContent = x;',
      'const FunctionName = 1; new FunctionRunner()'
    ];
    for (const code of fine) expect(findSinks(code), code).toEqual([]);
  });

  it('the scan really covers the production tree', () => {
    const files = productionFiles(SRC);
    expect(files.length).toBeGreaterThan(150);
    expect(files.some((f) => f === 'src/lib/supabase.ts')).toBe(true);
    expect(files.some((f) => f.includes('.test.'))).toBe(false);
  });

  it('no production file under src/ uses a sink (the web mitigation for a localStorage session)', () => {
    const hits: string[] = [];
    for (const file of productionFiles(SRC)) {
      for (const sink of findSinks(readFileSync(join(process.cwd(), file), 'utf8'))) {
        if (!ALLOWED.some((a) => a.file === file && a.sink === sink)) hits.push(`${file}: ${sink}`);
      }
    }
    expect(hits, `sinks found (review each; accepted ones need an ALLOWED entry with a reason):\n${hits.join('\n')}`).toEqual([]);
  });
});
