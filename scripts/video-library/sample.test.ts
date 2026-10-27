// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManifestRecord } from '../../src/types/video';
import { AGREED_UNMATCHED_TITLES, agreedManifest, makeRecord, parseCsv, sha, toJsonl } from './manifestFixture.testutil';
import { buildSample, EXPECTED_SAMPLE, runSample, SAMPLE_PLAN_HEADER, SampleDiscrepancyError, UNMATCHED_PATH_CANDIDATES } from './sample';
import { validateSampleText } from './sampleFile';

const discrepancies = (records: ManifestRecord[]): string[] => {
  try { buildSample(records); } catch (e) { expect(e).toBeInstanceOf(SampleDiscrepancyError); return (e as SampleDiscrepancyError).discrepancies; }
  throw new Error('expected a discrepancy');
};
const without = (records: ManifestRecord[], title: string) => records.filter((r) => r.title !== title);

describe('the agreed expectations', () => {
  it('are the ones that were approved', () => {
    expect(EXPECTED_SAMPLE.unmatchedTitles).toEqual(AGREED_UNMATCHED_TITLES);
    expect([EXPECTED_SAMPLE.matched, EXPECTED_SAMPLE.needsReview, EXPECTED_SAMPLE.unmatchedTitles.length, EXPECTED_SAMPLE.total]).toEqual([10, 8, 7, 25]);
    expect(EXPECTED_SAMPLE.totalBytes).toBe(13_635_796);
    expect(Object.values(EXPECTED_SAMPLE.bytesByStatus).reduce((a, b) => a + b, 0)).toBe(13_635_796);
  });
});

describe('buildSample: exact selection', () => {
  it('selects 10 matched + 8 needs_review + the 7 agreed unmatched = 25 distinct hashes and 13,635,796 bytes', () => {
    const s = buildSample(agreedManifest());
    expect(s.records).toHaveLength(25);
    expect(new Set(s.records.map((r) => r.sha256)).size).toBe(25);
    expect(s.counts).toEqual({ matched: 10, needs_review: 8, unmatched: 7 });
    expect(s.bytesByStatus).toEqual({ matched: 6_775_928, needs_review: 3_545_578, unmatched: 3_314_290 });
    expect(s.totalBytes).toBe(13_635_796);
  });

  it('puts matched, then needs_review, then the unmatched in the AGREED order (not manifest order)', () => {
    const s = buildSample(agreedManifest());
    expect(s.records.slice(0, 10).every((r) => r.match?.reviewStatus === 'matched')).toBe(true);
    expect(s.records.slice(10, 18).every((r) => r.match?.reviewStatus === 'needs_review')).toBe(true);
    expect(s.records.slice(18).map((r) => r.title)).toEqual(AGREED_UNMATCHED_TITLES);
  });

  it('ignores other unmatched videos, duplicate records and non-ok records', () => {
    const titles = buildSample(agreedManifest()).records.map((r) => r.title);
    expect(titles).not.toContain('Some Other Unmatched Video');
    expect(titles).not.toContain('Broken');
    expect(titles.filter((t) => t === 'Matched Video 1')).toHaveLength(1);
  });

  it('keeps the seven unmatched entries unmapped', () => {
    for (const r of buildSample(agreedManifest()).records.slice(18)) {
      expect(r.match?.reviewStatus).toBe('unmatched');
      expect(r.match?.exerciseKey).toBeNull();
    }
  });

  it('does not mutate the records it was given', () => {
    const input = agreedManifest();
    const before = JSON.stringify(input);
    buildSample(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('buildSample: stops with a discrepancy report instead of substituting', () => {
  it('reports a title that is missing (including a near miss and a case-only difference)', () => {
    const near = agreedManifest().map((r) => (r.title === 'Barbell Reverse Wrist Curl (over-grip)' ? { ...r, title: 'Barbell Reverse Wrist Curl (overgrip)' } : r));
    expect(discrepancies(near).join('\n')).toContain('title not found (exact match required): "Barbell Reverse Wrist Curl (over-grip)"');
    const cased = agreedManifest().map((r) => (r.title === 'Treadmill Running' ? { ...r, title: 'treadmill running' } : r));
    expect(discrepancies(cased).join('\n')).toContain('"Treadmill Running"');
    expect(discrepancies(without(agreedManifest(), 'Cable Standing Inner Curl')).join('\n')).toContain('"Cable Standing Inner Curl"');
  });

  it('does not pick a lookalike when a title is missing, even if another unmatched video exists', () => {
    const records = without(agreedManifest(), 'Band Standing Calf Raise');
    expect(() => buildSample(records)).toThrow(/Nothing was written and nothing was substituted/);
  });

  it('reports the wrong number of matched or needs_review videos', () => {
    const eleven = [...agreedManifest(), makeRecord({ n: 900, title: 'Extra Matched', review: 'matched' })];
    expect(discrepancies(eleven).join('\n')).toContain('expected 10 matched video(s), the manifest has 11');
    const seven = agreedManifest().filter((r) => r.title !== 'Review Video 3');
    expect(discrepancies(seven).join('\n')).toContain('expected 8 needs_review video(s), the manifest has 7');
  });

  it('resolves known duplicate basenames only when exact permitted paths and the agreed byte total identify one selection', () => {
    const titles: readonly string[] = EXPECTED_SAMPLE.unmatchedTitles;
    const records = agreedManifest().map((r) => {
      if (!titles.includes(r.title) || r.title === 'Weighted Standing Curl (weights or lever)') return r;
      const paths = UNMATCHED_PATH_CANDIDATES[r.title];
      return { ...r, entryName: paths[0] };
    });
    let n = 2000;
    for (const title of titles) {
      if (title === 'Weighted Standing Curl (weights or lever)') continue;
      const paths = UNMATCHED_PATH_CANDIDATES[title];
      const base = records.find((r) => r.title === title)!;
      records.push({ ...base, entryIndex: ++n, entryName: paths[1], sha256: sha(n), sizeBytes: (base.sizeBytes ?? 0) + 1 });
    }
    const sample = buildSample(records);
    expect(sample.records.slice(18).map((r) => r.entryName)).toEqual(titles.map((title) => {
      const path = UNMATCHED_PATH_CANDIDATES[title]?.[0];
      return path ?? records.find((r) => r.title === title)!.entryName;
    }));
  });

  it('refuses duplicate path candidates when the byte invariant cannot uniquely resolve them', () => {
    const titles: readonly string[] = EXPECTED_SAMPLE.unmatchedTitles;
    const records = agreedManifest().map((r) => {
      if (!titles.includes(r.title) || r.title === 'Weighted Standing Curl (weights or lever)') return r;
      return { ...r, entryName: UNMATCHED_PATH_CANDIDATES[r.title][0] };
    });
    let n = 3000;
    for (const title of titles) {
      if (title === 'Weighted Standing Curl (weights or lever)') continue;
      const base = records.find((r) => r.title === title)!;
      records.push({ ...base, entryIndex: ++n, entryName: UNMATCHED_PATH_CANDIDATES[title][1], sha256: sha(n), sizeBytes: base.sizeBytes });
    }
    expect(discrepancies(records).join('\n')).toContain('have 64 combinations matching the agreed unmatched byte total');
  });

  it('reports a title shared by two different videos as ambiguous', () => {
    const records = [...agreedManifest(), makeRecord({ n: 901, title: 'Treadmill Running', review: 'unmatched', path: 'Other/Treadmill Running.mp4' })];
    expect(discrepancies(records).join('\n')).toMatch(/"Treadmill Running" is ambiguous/);
  });

  it('reports a title whose video is no longer unmatched', () => {
    const records = agreedManifest().map((r) => (r.title === 'Treadmill Running' ? makeRecord({ n: r.entryIndex, title: r.title, review: 'needs_review', size: 473_470 }) : r));
    expect(discrepancies(records).join('\n')).toContain('"Treadmill Running" is needs_review in the manifest, expected unmatched');
  });

  it('reports a title that only exists as a non-ok entry', () => {
    const records = agreedManifest().map((r) => (r.title === 'Treadmill Running' ? makeRecord({ n: r.entryIndex, title: r.title, status: 'invalid_mp4', size: 473_470 }) : r));
    expect(discrepancies(records).join('\n')).toContain('only as non-ok manifest entries (invalid_mp4)');
  });

  it('reports an agreed unmatched video that unexpectedly carries an exercise key', () => {
    const records = agreedManifest().map((r) => (r.title === 'Treadmill Running' ? { ...r, match: { ...r.match!, exerciseKey: 'treadmill-run' } } : r));
    expect(discrepancies(records).join('\n')).toContain('unexpectedly carries exercise key treadmill-run');
  });

  it('reports byte differences per status and in total', () => {
    const records = agreedManifest().map((r) => (r.title === 'Treadmill Running' ? { ...r, sizeBytes: 473_471 } : r));
    const d = discrepancies(records).join('\n');
    expect(d).toContain('unmatched bytes: expected 3314290, found 3314291');
    expect(d).toContain('total bytes: expected 13635796, found 13635797');
  });

  it('includes what the manifest actually contains', () => {
    try { buildSample(without(agreedManifest(), 'Treadmill Running')); throw new Error('no throw'); }
    catch (e) { expect((e as SampleDiscrepancyError).facts[0]).toMatch(/ok video\(s\): 10 matched, 8 needs_review, 7 unmatched/); }
  });

  it('collects every discrepancy at once', () => {
    const records = without([...agreedManifest(), makeRecord({ n: 902, title: 'Extra Matched', review: 'matched' })], 'Treadmill Running');
    expect(discrepancies(records).length).toBeGreaterThanOrEqual(2);
  });
});

describe('runSample (files)', () => {
  let work: string;
  beforeEach(() => { work = mkdtempSync(path.join(tmpdir(), 'sampl-')); });
  afterEach(() => { rmSync(work, { recursive: true, force: true }); });
  const writeManifest = (records: ManifestRecord[]) => writeFileSync(path.join(work, 'manifest.jsonl'), toJsonl(records));

  it('writes sample.txt (25 lowercase hashes) and sample-plan.csv, and leaves the manifest untouched', () => {
    writeManifest(agreedManifest());
    const before = readFileSync(path.join(work, 'manifest.jsonl'), 'utf8');
    const r = runSample({ workDir: work });
    const lines = readFileSync(r.samplePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(25);
    expect(new Set(lines).size).toBe(25);
    expect(lines.every((l) => /^[0-9a-f]{64}$/.test(l))).toBe(true);
    expect(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8')).toBe(before);
  });

  it('writes a plan that maps nothing: only matched rows carry an exercise key and only they are visible', () => {
    writeManifest(agreedManifest());
    const r = runSample({ workDir: work });
    const [header, ...rows] = parseCsv(readFileSync(r.planPath, 'utf8'));
    expect(header).toEqual(SAMPLE_PLAN_HEADER);
    expect(rows).toHaveLength(25);
    const col = (name: string) => header.indexOf(name);
    for (const row of rows) {
      const review = row[col('review_status')];
      expect(row[col('exercise_key')] !== '').toBe(review === 'matched');
      expect(row[col('visible_to_users_once_uploaded')]).toBe(review === 'matched' ? 'yes' : 'no');
      if (review === 'unmatched') expect(row[col('suggested_exercise_key')]).toBe('');
      if (review === 'needs_review') expect(row[col('suggested_exercise_key')]).toBe('cable-lateral-raise');
    }
    expect(rows.slice(18).map((row) => row[col('title')])).toEqual(AGREED_UNMATCHED_TITLES);
    expect(rows.map((row) => Number(row[col('size_bytes')])).reduce((a, b) => a + b, 0)).toBe(13_635_796);
  });

  it('produces a sample file that the ingest validator accepts against the same manifest', () => {
    const records = agreedManifest();
    writeManifest(records);
    const r = runSample({ workDir: work });
    expect(validateSampleText(readFileSync(r.samplePath, 'utf8'), records)).toHaveLength(25);
  });

  it('is deterministic', () => {
    writeManifest(agreedManifest());
    const a = readFileSync(runSample({ workDir: work }).planPath, 'utf8');
    const b = readFileSync(runSample({ workDir: work }).planPath, 'utf8');
    expect(a).toBe(b);
  });

  it('writes NOTHING when the manifest disagrees', () => {
    writeManifest(without(agreedManifest(), 'Treadmill Running'));
    expect(() => runSample({ workDir: work })).toThrow(SampleDiscrepancyError);
    expect(existsSync(path.join(work, 'sample.txt'))).toBe(false);
    expect(existsSync(path.join(work, 'sample-plan.csv'))).toBe(false);
  });

  it('fails clearly without a manifest, and refuses an incomplete (partly unreadable) manifest', () => {
    expect(() => runSample({ workDir: work })).toThrow(/Manifest not found/);
    writeFileSync(path.join(work, 'manifest.jsonl'), toJsonl(agreedManifest()) + '{not json}\n');
    expect(() => runSample({ workDir: work })).toThrow(/unreadable line/);
    expect(existsSync(path.join(work, 'sample.txt'))).toBe(false);
  });

  it('is unaffected by hash collisions only in duplicate records', () => {
    const records = [...agreedManifest(), makeRecord({ n: 950, title: 'Treadmill Running', status: 'duplicate', sha: sha(950), path: 'Dupe/Treadmill Running.mp4' })];
    expect(buildSample(records).records).toHaveLength(25);
  });
});
