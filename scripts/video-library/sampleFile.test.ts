// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSampleFile, MAX_SAMPLE_FILE_BYTES, parseSampleText, SampleFileError, validateSampleText } from './sampleFile';
import { makeRecord, sha } from './manifestFixture.testutil';

const records = () => [
  makeRecord({ n: 1, title: 'Bench', review: 'matched' }),
  makeRecord({ n: 2, title: 'Squat', review: 'needs_review' }),
  makeRecord({ n: 3, title: 'Yoga', review: 'unmatched' }),
  makeRecord({ n: 4, title: 'Bench copy', status: 'duplicate', sha: sha(1) }),
  makeRecord({ n: 5, title: 'Broken', status: 'invalid_mp4' }),
  makeRecord({ n: 6, title: 'Huge', status: 'too_large', sha: null })
];
const msg = (fn: () => unknown): string => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(SampleFileError); return (e as Error).message; } throw new Error('expected a throw'); };

describe('parseSampleText', () => {
  it('reads one hash per line, ignoring blank lines, # comments, CRLF and a BOM', () => {
    const text = `\uFEFF# header\r\n${sha(1)}\r\n\r\n   ${sha(2)}   \n#${sha(3)}\n${sha(3)}`;
    expect(parseSampleText(text)).toEqual([{ sha256: sha(1), line: 2 }, { sha256: sha(2), line: 4 }, { sha256: sha(3), line: 6 }]);
  });

  it('rejects malformed hashes and reports every bad line, not only the first', () => {
    const m = msg(() => parseSampleText([sha(1), 'abc123', sha(10).toUpperCase(), `${sha(3)}0`, `g${sha(4).slice(1)}`, 'two words'].join('\n')));
    expect(m).toContain('5 problems');
    expect(m).toContain('line 2');
    expect(m).toContain('line 3'); // uppercase is not accepted
    expect(m).toContain('line 4'); // 65 chars
    expect(m).toContain('line 5'); // non-hex
    expect(m).toContain('line 6');
  });

  it('rejects an empty or comment-only file', () => {
    expect(msg(() => parseSampleText(''))).toContain('no SHA-256 values');
    expect(msg(() => parseSampleText('# nothing here\n\n'))).toContain('no SHA-256 values');
  });

  it('truncates very long junk lines in its message', () => {
    expect(msg(() => parseSampleText('x'.repeat(5000))).length).toBeLessThan(400);
  });
});

describe('validateSampleHashes / validateSampleText', () => {
  it('returns the ok manifest records in sample-file order', () => {
    const out = validateSampleText([sha(3), sha(1), sha(2)].join('\n'), records());
    expect(out.map((r) => r.title)).toEqual(['Yoga', 'Bench', 'Squat']);
    expect(out.every((r) => r.status === 'ok')).toBe(true);
  });

  it('resolves a hash that also has duplicate records to the kept (ok) entry', () => {
    const [r] = validateSampleText(sha(1), records());
    expect(r.title).toBe('Bench');
  });

  it('rejects unknown hashes', () => {
    const m = msg(() => validateSampleText([sha(1), sha(999)].join('\n'), records()));
    expect(m).toContain('line 2');
    expect(m).toContain(`${sha(999)} is not in the manifest`);
  });

  it('rejects hashes that exist only as non-ok entries, naming the status', () => {
    const m = msg(() => validateSampleText(sha(5), records()));
    expect(m).toContain('not an ok manifest entry');
    expect(m).toContain('invalid_mp4');
  });

  it('rejects a hash listed twice, pointing at the first line', () => {
    const m = msg(() => validateSampleText([sha(1), sha(2), sha(1)].join('\n'), records()));
    expect(m).toContain('line 3');
    expect(m).toContain('listed twice (first on line 1)');
  });

  it('reports all kinds of problems together', () => {
    const m = msg(() => validateSampleText([sha(1), sha(1), sha(999), sha(5)].join('\n'), records()));
    expect(m).toContain('3 problems');
  });

  it('does not match on prefixes, and a near-miss hash is simply unknown', () => {
    expect(msg(() => validateSampleText(sha(1).slice(0, 63), records()))).toContain('not a 64-character');
    expect(msg(() => validateSampleText(sha(1).replace(/1$/, 'f'), records()))).toContain('is not in the manifest');
  });
});

describe('loadSampleFile', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'smp-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loads a valid file', () => {
    const p = path.join(dir, 's.txt');
    writeFileSync(p, `${sha(2)}\n${sha(1)}\n`);
    expect(loadSampleFile(p, records()).map((r) => r.title)).toEqual(['Squat', 'Bench']);
  });

  it('fails clearly for a missing file, a directory, an oversized file and a binary file', () => {
    expect(msg(() => loadSampleFile(path.join(dir, 'nope.txt'), records()))).toContain('not found or unreadable');
    mkdirSync(path.join(dir, 'd'));
    expect(msg(() => loadSampleFile(path.join(dir, 'd'), records()))).toContain('not a regular file');
    const big = path.join(dir, 'big.txt');
    writeFileSync(big, 'a'.repeat(MAX_SAMPLE_FILE_BYTES + 1));
    expect(msg(() => loadSampleFile(big, records()))).toContain('too large');
    const bin = path.join(dir, 'bin.txt');
    writeFileSync(bin, Buffer.from([0, 1, 2, 3, 0]));
    expect(msg(() => loadSampleFile(bin, records()))).toContain('does not look like text');
  });

  it('fails on an empty file', () => {
    const p = path.join(dir, 'e.txt');
    writeFileSync(p, '');
    expect(msg(() => loadSampleFile(p, records()))).toContain('no SHA-256 values');
  });
});
