// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManifestRecord } from '../../src/types/video';
import { DUPLICATES_HEADER, duplicatesCsv, groupDuplicates, runDuplicates } from './duplicates';
import { runInventory } from './inventory';
import { makeRecord, parseCsv, sha, toJsonl } from './manifestFixture.testutil';
import { parseManifest } from '../../src/utils/videoLibrary/manifest';
import { buildZip, fakeMp4 } from './zipFixture.testutil';

const kept = (n: number, title: string, p: string) => makeRecord({ n, title, path: p });
const dup = (n: number, title: string, p: string, of: number) => makeRecord({ n, title, path: p, status: 'duplicate', sha: sha(of), duplicateOf: 'x' });

describe('groupDuplicates', () => {
  it('groups duplicates by SHA-256 with the kept path and all duplicate paths', () => {
    const { groups, warnings } = groupDuplicates([
      kept(1, 'Back Squat', 'girl/Back Squat.mp4'),
      dup(2, 'Back Squat', 'men/Back Squat.mp4', 1),
      dup(3, 'Back Squat', 'misc/Back Squat.mp4', 1),
      kept(4, 'Unique', 'a/Unique.mp4')
    ]);
    expect(warnings).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      sha256: sha(1), keptPath: 'girl/Back Squat.mp4', keptTitle: 'Back Squat',
      duplicatePaths: ['men/Back Squat.mp4', 'misc/Back Squat.mp4'], duplicateTitles: ['Back Squat', 'Back Squat'],
      titlesDiffer: false, proposedCanonicalTitle: 'Back Squat'
    });
  });

  it('flags conflicting titles and leaves the proposed title blank', () => {
    const { groups } = groupDuplicates([
      kept(1, 'Elliptical', 'girl/Elliptical.mp4'),
      dup(2, 'Cardio Exercises Machine', 'men/Cardio Exercises Machine.mp4', 1)
    ]);
    expect(groups[0].titlesDiffer).toBe(true);
    expect(groups[0].proposedCanonicalTitle).toBe('');
  });

  it('never infers a canonical title from manifest order (reversed order gives the same blanks)', () => {
    const a = groupDuplicates([kept(1, 'Elliptical', 'a.mp4'), dup(2, 'Cardio Exercises Machine', 'b.mp4', 1)]).groups[0];
    const b = groupDuplicates([kept(1, 'Cardio Exercises Machine', 'b.mp4'), dup(2, 'Elliptical', 'a.mp4', 1)]).groups[0];
    expect(a.proposedCanonicalTitle).toBe('');
    expect(b.proposedCanonicalTitle).toBe('');
    expect([a.keptTitle, ...a.duplicateTitles].sort()).toEqual([b.keptTitle, ...b.duplicateTitles].sort());
  });

  it('handles three different names for one video', () => {
    const { groups } = groupDuplicates([kept(1, 'A', 'a.mp4'), dup(2, 'B', 'b.mp4', 1), dup(3, 'C', 'c.mp4', 1)]);
    expect(groups[0].titlesDiffer).toBe(true);
    expect(groups[0].duplicateTitles).toEqual(['B', 'C']);
  });

  it('does not call a case/whitespace-only difference a conflict, and does not pre-fill it either', () => {
    const { groups } = groupDuplicates([kept(1, 'Hanging Leg Raise', 'a.mp4'), dup(2, 'hanging  leg raise', 'b.mp4', 1)]);
    expect(groups[0].titlesDiffer).toBe(false);
    expect(groups[0].proposedCanonicalTitle).toBe('');
  });

  it('sorts conflicts first, then by kept path', () => {
    const { groups } = groupDuplicates([
      kept(1, 'Same', 'z.mp4'), dup(2, 'Same', 'z2.mp4', 1),
      kept(3, 'Same2', 'a.mp4'), dup(4, 'Same2', 'a2.mp4', 3),
      kept(5, 'One', 'm.mp4'), dup(6, 'Two', 'm2.mp4', 5)
    ]);
    expect(groups.map((g) => g.keptPath)).toEqual(['m.mp4', 'a.mp4', 'z.mp4']);
  });

  it('ignores non-duplicate statuses, even when they share a hash', () => {
    const { groups } = groupDuplicates([kept(1, 'A', 'a.mp4'), makeRecord({ n: 2, title: 'B', status: 'invalid_mp4', sha: sha(1) })]);
    expect(groups).toEqual([]);
  });

  it('warns, instead of guessing, when the kept entry or a hash is missing', () => {
    const { groups, warnings } = groupDuplicates([dup(2, 'Orphan', 'o.mp4', 77), makeRecord({ n: 3, title: 'NoHash', status: 'duplicate', sha: null, duplicateOf: 'x' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keptPath).toBeNull();
    expect(warnings.some((w) => w.includes('no kept (ok) entry'))).toBe(true);
    expect(warnings.some((w) => w.includes('has no sha256'))).toBe(true);
  });
});

describe('duplicatesCsv', () => {
  it('has the agreed columns, a blank review_decision, and escapes awkward paths', () => {
    const groups = groupDuplicates([kept(1, 'Say "Hi", Curl', 'girl/Say "Hi", Curl.mp4'), dup(2, 'Other Name', 'men/Other Name.mp4', 1)]).groups;
    const [header, row, ...rest] = parseCsv(duplicatesCsv(groups));
    expect(rest).toEqual([]);
    expect(header).toEqual(DUPLICATES_HEADER);
    const c = (n: string) => row[header.indexOf(n)];
    expect(c('sha256')).toBe(sha(1));
    expect(c('kept_path')).toBe('girl/Say "Hi", Curl.mp4');
    expect(c('duplicate_paths')).toBe('men/Other Name.mp4');
    expect(c('kept_title')).toBe('Say "Hi", Curl');
    expect(c('duplicate_titles')).toBe('Other Name');
    expect(c('titles_differ')).toBe('yes');
    expect(c('proposed_canonical_title')).toBe('');
    expect(c('review_decision')).toBe('');
  });

  it('joins several duplicates in matching order and writes only the header when there are none', () => {
    const [, row] = parseCsv(duplicatesCsv(groupDuplicates([kept(1, 'A', 'a.mp4'), dup(2, 'A', 'b.mp4', 1), dup(3, 'A', 'c.mp4', 1)]).groups));
    expect(row[2]).toBe('b.mp4 | c.mp4');
    expect(row[4]).toBe('A | A');
    expect(duplicatesCsv([])).toBe(DUPLICATES_HEADER.join(',') + '\n');
  });
});

describe('runDuplicates', () => {
  let work: string;
  beforeEach(() => { work = mkdtempSync(path.join(tmpdir(), 'dup-')); });
  afterEach(() => { rmSync(work, { recursive: true, force: true }); });

  it('writes duplicates.csv from the manifest and does not modify the manifest', () => {
    const records: ManifestRecord[] = [kept(1, 'A', 'a.mp4'), dup(2, 'B', 'b.mp4', 1), kept(3, 'C', 'c.mp4')];
    writeFileSync(path.join(work, 'manifest.jsonl'), toJsonl(records));
    const before = readFileSync(path.join(work, 'manifest.jsonl'), 'utf8');
    const r = runDuplicates({ workDir: work });
    expect(r.groups).toHaveLength(1);
    expect(r.conflicting).toBe(1);
    expect(parseCsv(readFileSync(r.csvPath, 'utf8'))).toHaveLength(2);
    expect(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8')).toBe(before);
  });

  it('fails clearly without a manifest, and warns about unreadable lines', () => {
    expect(() => runDuplicates({ workDir: work })).toThrow(/Manifest not found/);
    writeFileSync(path.join(work, 'manifest.jsonl'), toJsonl([kept(1, 'A', 'a.mp4')]) + 'garbage\n');
    expect(runDuplicates({ workDir: work }).warnings.join(' ')).toContain('unreadable line');
  });

  it('works end to end on a real inventory: identical bytes under different names are a conflict', async () => {
    const same = fakeMp4('same');
    const zipPath = path.join(work, 'lib.zip');
    writeFileSync(zipPath, buildZip([
      { name: 'girl/Elliptical.mp4', data: same },
      { name: 'men/Cardio Exercises Machine.mp4', data: same },
      { name: 'men/Yoga Flow.mp4', data: fakeMp4('yoga') }
    ]));
    await runInventory({ zipPath, workDir: work, probe: null });
    const r = runDuplicates({ workDir: work });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ keptPath: 'girl/Elliptical.mp4', duplicatePaths: ['men/Cardio Exercises Machine.mp4'], titlesDiffer: true, proposedCanonicalTitle: '' });
    const { records } = parseManifest(readFileSync(path.join(work, 'manifest.jsonl'), 'utf8'));
    expect(records.filter((x) => x.status === 'duplicate')).toHaveLength(1);
  });
});
