// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BatchError, batchPlanCsv, pickNextBatch, renderPublishSql, runBatch } from './batch';
import { makeRecord, parseCsv, sha, toJsonl } from './manifestFixture.testutil';

const TEMPLATE = readFileSync(path.resolve('supabase/manual/publish_videos.sql'), 'utf8');
const NONE = new Set<string>();
const limits = { size: 50, maxBytes: 100 * 1024 * 1024 };

const rec = (n: number, title: string, p?: string, size = 1000) => makeRecord({ n, title, size, path: p ?? `Lib/${title}.mp4` });

describe('pickNextBatch', () => {
  it('takes only ok records, never duplicates or non-ok entries', () => {
    const records = [rec(1, 'A'), makeRecord({ n: 2, title: 'B', status: 'duplicate', sha: sha(1) }), makeRecord({ n: 3, title: 'C', status: 'invalid_mp4', size: 20 })];
    expect(pickNextBatch(records, NONE, limits).records.map((r) => r.title)).toEqual(['A']);
  });

  it('skips excluded hashes (already uploaded, in the sample or in an earlier batch)', () => {
    const records = [rec(1, 'A'), rec(2, 'B'), rec(3, 'C')];
    const p = pickNextBatch(records, new Set([sha(2)]), limits);
    expect(p.records.map((r) => r.title)).toEqual(['A', 'C']);
    expect(p.eligible).toBe(2);
  });

  it('orders by normalized title then path, independent of manifest order', () => {
    const records = [rec(1, 'zebra'), rec(2, 'Apple', 'Lib/men/Apple.mp4'), rec(3, 'apple', 'Lib/girl/apple.mp4')];
    expect(pickNextBatch(records, NONE, limits).records.map((r) => r.entryName)).toEqual(['Lib/girl/apple.mp4', 'Lib/men/Apple.mp4', 'Lib/zebra.mp4']);
  });

  it('respects the count limit and reports what remains', () => {
    const records = Array.from({ length: 7 }, (_, i) => rec(i + 1, `V${i + 1}`));
    const p = pickNextBatch(records, NONE, { size: 3, maxBytes: 1e9 });
    expect(p.records).toHaveLength(3);
    expect(p.remaining).toBe(4);
    expect(p.remainingBytes).toBe(4000);
  });

  it('respects the byte limit', () => {
    const records = [rec(1, 'A', undefined, 600), rec(2, 'B', undefined, 600), rec(3, 'C', undefined, 600)];
    expect(pickNextBatch(records, NONE, { size: 50, maxBytes: 1300 }).records).toHaveLength(2);
  });

  it('keeps same-title (girl/men) videos together by moving the whole group to the next batch', () => {
    const records = [rec(1, 'A'), rec(2, 'B', 'Lib/girl/B.mp4'), rec(3, 'B', 'Lib/men/B.mp4')];
    const first = pickNextBatch(records, NONE, { size: 2, maxBytes: 1e9 });
    expect(first.records.map((r) => r.title)).toEqual(['A']);
    const second = pickNextBatch(records, new Set(first.records.map((r) => r.sha256!)), { size: 2, maxBytes: 1e9 });
    expect(second.records.map((r) => r.entryName)).toEqual(['Lib/girl/B.mp4', 'Lib/men/B.mp4']);
  });

  it('splits a group that alone exceeds the limits, and always makes progress', () => {
    const records = [rec(1, 'A', 'Lib/1/A.mp4'), rec(2, 'A', 'Lib/2/A.mp4'), rec(3, 'A', 'Lib/3/A.mp4')];
    expect(pickNextBatch(records, NONE, { size: 2, maxBytes: 1e9 }).records).toHaveLength(2);
    expect(pickNextBatch([rec(1, 'Big', undefined, 5000)], NONE, { size: 5, maxBytes: 10 }).records).toHaveLength(1);
  });

  it('rejects invalid limits and does not mutate its input', () => {
    const records = [rec(2, 'B'), rec(1, 'A')];
    const before = JSON.stringify(records);
    expect(() => pickNextBatch(records, NONE, { size: 0, maxBytes: 1 })).toThrow(BatchError);
    expect(() => pickNextBatch(records, NONE, { size: 1, maxBytes: 0 })).toThrow(BatchError);
    pickNextBatch(records, NONE, limits);
    expect(JSON.stringify(records)).toBe(before);
  });
});

describe('renderPublishSql', () => {
  it('replaces only the hash list of the real template and keeps every safety check', () => {
    const out = renderPublishSql(TEMPLATE, [sha(1), sha(2)], 'batch-01');
    expect(out).toContain(`'${sha(1)}',\n    '${sha(2)}'\n`);
    expect(out).not.toContain('REPLACE with your hashes');
    for (const guard of ['not 64 lowercase hex', 'not status=uploaded', 'published = false']) expect(out).toContain(guard);
    expect(out.indexOf('begin')).toBeGreaterThan(out.indexOf(sha(2)));
    expect(out.startsWith('-- GENERATED for batch-01')).toBe(true);
  });

  it('refuses a template that changed shape, and an empty list', () => {
    expect(() => renderPublishSql('select 1;', [sha(1)], 'b')).toThrow(BatchError);
    expect(() => renderPublishSql(TEMPLATE, [], 'b')).toThrow(BatchError);
  });
});

describe('batchPlanCsv', () => {
  it('writes one row per video with the catalog review status', () => {
    const rows = parseCsv(batchPlanCsv('batch-01', [rec(1, 'A'), makeRecord({ n: 2, title: 'B', review: 'matched' })]));
    expect(rows[0]).toContain('review_status');
    expect(rows).toHaveLength(3);
    expect(rows[1][3]).toBe('unmatched');
    expect(rows[2][3]).toBe('matched');
    expect(rows[2][8]).toBe('barbell-bench-press');
  });
});

describe('runBatch', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'batch-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const setup = (records = Array.from({ length: 5 }, (_, i) => rec(i + 1, `V${i + 1}`))) => writeFileSync(path.join(dir, 'manifest.jsonl'), toJsonl(records));
  const run = (size = 2) => runBatch({ workDir: dir, limits: { size }, publishTemplate: path.resolve('supabase/manual/publish_videos.sql') });

  it('writes the three files, numbered from 01', () => {
    setup();
    const r = run();
    expect(r.label).toBe('batch-01');
    expect(readdirSync(path.join(dir, 'batches')).sort()).toEqual(['batch-01.plan.csv', 'batch-01.publish.sql', 'batch-01.txt']);
    const hashes = readFileSync(r.batchPath, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
    expect(hashes).toEqual([sha(1), sha(2)]);
  });

  it('numbers the next batch after the last one and never repeats a hash', () => {
    setup();
    run(); const second = run(); const third = run();
    expect([second.label, third.label]).toEqual(['batch-02', 'batch-03']);
    const all = ['batch-01', 'batch-02', 'batch-03'].flatMap((b) => readFileSync(path.join(dir, 'batches', `${b}.txt`), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')));
    expect(all).toHaveLength(5);
    expect(new Set(all).size).toBe(5);
    expect(() => run()).toThrow(/Nothing left to batch/);
  });

  it('excludes uploaded hashes from ingest-state.json and the hashes in sample.txt', () => {
    setup();
    writeFileSync(path.join(dir, 'ingest-state.json'), JSON.stringify({ version: 1, items: { [sha(1)]: { status: 'uploaded', attempts: 1, at: 'x' }, [sha(2)]: { status: 'failed', attempts: 1, at: 'x' } } }));
    writeFileSync(path.join(dir, 'sample.txt'), `${sha(3)}\n`);
    expect(readFileSync(run(10).batchPath, 'utf8')).toContain(sha(2)); // a failed upload is retried
    const text = readFileSync(path.join(dir, 'batches', 'batch-01.txt'), 'utf8');
    expect(text).not.toContain(sha(1));
    expect(text).not.toContain(sha(3));
    expect(text).toContain(sha(4));
  });

  it('refuses a manifest with unreadable lines, a missing manifest and a corrupt state file', () => {
    expect(() => run()).toThrow(/Manifest not found/);
    writeFileSync(path.join(dir, 'manifest.jsonl'), 'not json\n');
    expect(() => run()).toThrow(/unreadable/);
    setup();
    writeFileSync(path.join(dir, 'ingest-state.json'), '{oops');
    expect(() => run()).toThrow(/not valid JSON/);
    expect(existsSync(path.join(dir, 'batches'))).toBe(false);
  });

  it('never overwrites an existing batch file', () => {
    setup();
    mkdirSync(path.join(dir, 'batches'));
    writeFileSync(path.join(dir, 'batches', 'batch-01.plan.csv'), 'keep');
    writeFileSync(path.join(dir, 'batches', 'batch-00.txt'), `${sha(99)}\n`); // number 0 -> next is 01 -> collides
    expect(() => run()).toThrow(/already exists/);
    expect(readFileSync(path.join(dir, 'batches', 'batch-01.plan.csv'), 'utf8')).toBe('keep');
    expect(existsSync(path.join(dir, 'batches', 'batch-01.txt'))).toBe(false);
  });

  it('produces files the real sample-file validator accepts', async () => {
    setup();
    const r = run(3);
    const { loadSampleFile } = await import('./sampleFile');
    const { records } = (await import('../../src/utils/videoLibrary/manifest')).parseManifest(readFileSync(path.join(dir, 'manifest.jsonl'), 'utf8'));
    expect(loadSampleFile(r.batchPath, records)).toHaveLength(3);
  });
});
