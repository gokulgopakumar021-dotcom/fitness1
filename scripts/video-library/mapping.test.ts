// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getExerciseIndex } from '../../src/data/exerciseIndex';
import { csvRow, parseCsv } from './csv';
import { makeRecord, sha, toJsonl } from './manifestFixture.testutil';
import {
  buildCandidates, candidatesCsv, demoOf, ledgerPath, MappingError, parseLedger, renderMappingSql, runCandidates, runMapSql,
  scoreVideoForKey, validateDecisionsCsv, viewLedger, type MapDecision
} from './mapping';

const INDEX = getExerciseIndex();
const NO_LEDGER = viewLedger([]);
const entry = (key: string) => INDEX.find((e) => e.key === key)!;

const G = 'Lib/girl/Biceps';
const M = 'Lib/men/biceps';
const vid = (n: number, title: string, dir = G, review: 'matched' | 'needs_review' | 'unmatched' = 'unmatched') =>
  makeRecord({ n, title, review, path: `${dir}/${title}.mp4` });

const header = '"key","key_name","rank","sha256","title","entry_path","demo","score","equipment_conflict","decision","sort_order"';
const csvOf = (...rows: string[][]) => [header, ...rows.map((r) => csvRow(r))].join('\n') + '\n';
const row = (key: string, n: number, decision: string, sort = '') => [key, '', '1', sha(n), '', '', '', '', '', decision, sort];

describe('parseCsv', () => {
  it('reads quoted, unquoted, doubled-quote, CRLF, BOM and blank-line input', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\nlast,')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['last', '']]);
  });
  it('round-trips what csvRow writes', () => {
    const cells = ['a"b', 'c,d', 'multi\nline', ''];
    expect(parseCsv(csvRow(cells) + '\n')).toEqual([cells]);
  });
});

describe('demoOf', () => {
  it('reads the girl/men folder, case-insensitively, and nothing else', () => {
    expect(demoOf('Exercise/girl/Back/x.mp4')).toBe('female');
    expect(demoOf('Exercise/MEN/back/x.mp4')).toBe('male');
    expect(demoOf('Exercise\\men\\back\\x.mp4')).toBe('male');
    expect(demoOf('Exercise/mix/x.mp4')).toBe('');
    expect(demoOf('Exercise/women/x.mp4')).toBe('');
  });
});

describe('scoreVideoForKey', () => {
  it('scores a close title high and an unrelated one zero', () => {
    expect(scoreVideoForKey('Barbell Curl', entry('barbell-bicep-curl')).score).toBeGreaterThanOrEqual(0.6);
    expect(scoreVideoForKey('Treadmill Running', entry('barbell-bicep-curl')).score).toBe(0);
  });
  it('flags equipment that differs from the exercise instead of hiding the video', () => {
    expect(scoreVideoForKey('Dumbbell Lateral Raise', entry('cable-lateral-raise'))).toMatchObject({ equipmentConflict: true });
    expect(scoreVideoForKey('Cable Lateral Raise', entry('cable-lateral-raise'))).toMatchObject({ score: 1, equipmentConflict: false });
  });
});

describe('buildCandidates', () => {
  const records = [
    vid(1, 'Hammer Curl'), vid(2, 'Hammer Curl', M), vid(3, 'Dumbbell Hammer Curl'),
    vid(4, 'Treadmill Running'), vid(5, 'Face Pull'), vid(6, 'Hammer Curl Cross Body')
  ];
  const forKey = (rows: ReturnType<typeof buildCandidates>, key: string) => rows.filter((r) => r.key === key);

  it('lists the best videos per key, best first, with rank and demonstrator', () => {
    const rows = forKey(buildCandidates(records, INDEX, NO_LEDGER), 'hammer-curl');
    expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => i + 1));
    expect(rows[0].score).toBe(1);
    expect(rows.slice(0, 2).map((r) => r.demo).sort()).toEqual(['female', 'male']);
    expect(rows.map((r) => r.title)).not.toContain('Treadmill Running');
  });

  it('is deterministic and does not mutate its input', () => {
    const before = JSON.stringify(records);
    expect(buildCandidates([...records].reverse(), INDEX, NO_LEDGER)).toEqual(buildCandidates(records, INDEX, NO_LEDGER));
    expect(JSON.stringify(records)).toBe(before);
  });

  it('respects --per-key and --min-score', () => {
    expect(forKey(buildCandidates(records, INDEX, NO_LEDGER, { perKey: 1 }), 'hammer-curl')).toHaveLength(1);
    expect(forKey(buildCandidates(records, INDEX, NO_LEDGER, { minScore: 1 }), 'hammer-curl').every((r) => r.score === 1)).toBe(true);
    expect(() => buildCandidates(records, INDEX, NO_LEDGER, { perKey: 0 })).toThrow(MappingError);
    expect(() => buildCandidates(records, INDEX, NO_LEDGER, { minScore: 2 })).toThrow(MappingError);
  });

  it('skips non-ok records, duplicates of a hash, and videos that are already auto-matched', () => {
    const rs = [vid(1, 'Hammer Curl'), makeRecord({ n: 2, title: 'Hammer Curl', status: 'duplicate', sha: sha(1) }), vid(3, 'Hammer Curl', M, 'matched')];
    expect(forKey(buildCandidates(rs, INDEX, NO_LEDGER), 'hammer-curl').map((r) => r.sha256)).toEqual([sha(1)]);
  });

  it('never offers a video that was mapped, nor a (video, key) pair that was skipped', () => {
    const ledger = viewLedger([
      { sha256: sha(1), key: 'hammer-curl', decision: 'map', at: 't' },
      { sha256: sha(2), key: 'hammer-curl', decision: 'skip', at: 't' }
    ]);
    const rows = buildCandidates(records, INDEX, ledger);
    expect(rows.map((r) => r.sha256)).not.toContain(sha(1));
    expect(forKey(rows, 'hammer-curl').map((r) => r.sha256)).not.toContain(sha(2));
    // a skip is per key: the same video may still be offered for another key
    expect(scoreVideoForKey('Hammer Curl', entry('barbell-bicep-curl')).score).toBeGreaterThan(0);
  });
});

describe('candidatesCsv', () => {
  it('writes the header, leaves decision and sort_order blank, and marks equipment conflicts', () => {
    const rows = buildCandidates([vid(1, 'Dumbbell Lateral Raise', 'Lib/girl/Shoulders')], INDEX, NO_LEDGER);
    const table = parseCsv(candidatesCsv(rows));
    expect(table[0]).toEqual(['key', 'key_name', 'rank', 'sha256', 'title', 'entry_path', 'demo', 'score', 'equipment_conflict', 'decision', 'sort_order']);
    const r = table.find((t) => t[0] === 'cable-lateral-raise')!;
    expect(r[8]).toBe('yes');
    expect(r[9]).toBe('');
    expect(r[10]).toBe('');
  });
});

describe('validateDecisionsCsv', () => {
  const records = [vid(1, 'Hammer Curl'), vid(2, 'Hammer Curl', M), vid(3, 'Dumbbell Lateral Raise', 'Lib/girl/Shoulders'), vid(4, 'Hammer Curl', M, 'matched')];
  const check = (csv: string, ledger = NO_LEDGER) => validateDecisionsCsv(csv, INDEX, records, ledger);
  const problems = (csv: string, ledger = NO_LEDGER): string[] => {
    try { check(csv, ledger); } catch (e) { expect(e).toBeInstanceOf(MappingError); return (e as MappingError).problems; }
    throw new Error('expected the CSV to be rejected');
  };

  it('ignores blank decisions and accepts map and skip', () => {
    const d = check(csvOf(row('hammer-curl', 1, 'map'), row('hammer-curl', 2, ''), row('face-pull', 1, 'SKIP')));
    expect(d.map((x) => [x.key, x.decision])).toEqual([['hammer-curl', 'map'], ['face-pull', 'skip']]);
  });

  it('assigns sort_order after existing videos, in file order per key, unless one is given', () => {
    const d = check(csvOf(row('hammer-curl', 1, 'map'), row('hammer-curl', 2, 'map'), row('hammer-curl', 2, 'skip').map((c, i) => (i === 0 ? 'face-pull' : c)), row('barbell-bicep-curl', 3, 'skip')));
    expect(d.filter((x) => x.decision === 'map').map((x) => x.sortOrder)).toEqual([100, 110]);
    expect(check(csvOf(row('hammer-curl', 1, 'map', '5')))[0].sortOrder).toBe(5);
  });

  it('accepts a CSV re-saved by a spreadsheet: BOM, CRLF, unquoted cells, reordered columns', () => {
    const text = `\uFEFFdecision,sha256,key\r\nmap,${sha(1)},hammer-curl\r\n`;
    expect(check(text)).toHaveLength(1);
  });

  it('rejects everything, with every problem listed, when anything is wrong', () => {
    const p = problems(csvOf(
      row('hammer-curl', 1, 'maybe'), row('not-a-key', 1, 'map'), row('hammer-curl', 99, 'map'),
      row('hammer-curl', 2, 'map'), row('hammer-curl', 2, 'map'), row('hammer-curl', 1, 'map', '-3')
    ));
    expect(p).toHaveLength(5);
    expect(p.join('\n')).toMatch(/not one of/);
    expect(p.join('\n')).toMatch(/not an exercise key/);
    expect(p.join('\n')).toMatch(/not an ok video/);
    expect(p.join('\n')).toMatch(/listed twice/);
    expect(p.join('\n')).toMatch(/sort_order/);
  });

  it('requires the required columns and rejects an empty file', () => {
    expect(() => check('key,sha256\nhammer-curl,x\n')).toThrow(/missing required column/);
    expect(() => check('')).toThrow(/empty/);
  });

  it('needs an explicit decision for a different-equipment video, and says why', () => {
    expect(problems(csvOf(row('cable-lateral-raise', 3, 'map')))[0]).toMatch(/different equipment.*map_equipment_ok/);
    const d = check(csvOf(row('cable-lateral-raise', 3, 'map_equipment_ok')));
    expect(d[0]).toMatchObject({ decision: 'map', equipmentConfirmed: true });
  });

  it('refuses a video that is already auto-matched, or mapped to two keys in one file', () => {
    expect(problems(csvOf(row('hammer-curl', 4, 'map')))[0]).toMatch(/already auto-matched/);
    expect(problems(csvOf(row('hammer-curl', 1, 'map'), row('face-pull', 1, 'map')))[0]).toMatch(/mapped to both/);
  });

  it('never overwrites an earlier decision, but accepts repeating the same one', () => {
    const ledger = viewLedger([{ sha256: sha(1), key: 'hammer-curl', decision: 'map', at: 't' }]);
    expect(problems(csvOf(row('face-pull', 1, 'map')), ledger)[0]).toMatch(/never overwritten/);
    expect(check(csvOf(row('hammer-curl', 1, 'map')), ledger)).toHaveLength(1);
  });
});

describe('parseLedger', () => {
  it('refuses a damaged ledger instead of skipping lines', () => {
    expect(() => parseLedger('{"nope":1}\n')).toThrow(/damaged/);
    expect(() => parseLedger('not json\n')).toThrow(MappingError);
    expect(parseLedger('')).toEqual([]);
  });
});

describe('renderMappingSql', () => {
  const d = (n: number, key: string, p = 'Lib/girl/x.mp4'): MapDecision => ({ sha256: sha(n), key, decision: 'map', sortOrder: 100, equipmentConfirmed: false, entryPath: p });

  it('contains every guard and never publishes', () => {
    const sql = renderMappingSql([d(1, 'hammer-curl')], 'candidates-01.csv');
    for (const guard of ['unknown or not status=uploaded', 'never overwritten', "review_status in ('needs_review', 'unmatched')", "match_method     = 'manual'"]) expect(sql).toContain(guard);
    expect(sql).not.toMatch(/published\s*=\s*true/i);
    expect(sql).toContain('"demo:female"');
  });

  it('adds no demo tag when the path names neither demonstrator, and refuses nothing-to-map or invalid input', () => {
    expect(renderMappingSql([d(1, 'hammer-curl', 'Lib/mix/x.mp4')], 'x')).toContain('"tags": []');
    expect(() => renderMappingSql([], 'x')).toThrow(MappingError);
    expect(() => renderMappingSql([{ ...d(1, "x'; drop table t; --") }], 'x')).toThrow(MappingError);
    expect(() => renderMappingSql([{ ...d(1, 'hammer-curl'), sha256: 'zz' }], 'x')).toThrow(MappingError);
  });
});

describe('runCandidates and runMapSql (files)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'map-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const manifest = () => writeFileSync(path.join(dir, 'manifest.jsonl'), toJsonl([vid(1, 'Hammer Curl'), vid(2, 'Hammer Curl', M), vid(3, 'Face Pull', 'Lib/girl/Shoulders')]));
  const decide = (file: string, ...rows: string[][]) => { writeFileSync(file, csvOf(...rows)); return file; };

  it('writes candidates-01, then candidates-02 without touching the first', () => {
    manifest();
    const a = runCandidates({ workDir: dir });
    const first = readFileSync(a.path, 'utf8');
    const b = runCandidates({ workDir: dir });
    expect([path.basename(a.path), path.basename(b.path)]).toEqual(['candidates-01.csv', 'candidates-02.csv']);
    expect(readFileSync(a.path, 'utf8')).toBe(first);
    expect(first.startsWith('\uFEFF')).toBe(true);
  });

  it('refuses a missing, damaged or incomplete manifest', () => {
    expect(() => runCandidates({ workDir: dir })).toThrow(/Manifest not found/);
    writeFileSync(path.join(dir, 'manifest.jsonl'), 'garbage\n');
    expect(() => runCandidates({ workDir: dir })).toThrow(/unreadable/);
  });

  it('turns decisions into a SQL file and a ledger, and a second candidates run no longer offers decided videos', () => {
    manifest();
    const c1 = runCandidates({ workDir: dir }).path;
    const r = runMapSql({ workDir: dir, csvPath: decide(c1, row('hammer-curl', 1, 'map'), row('hammer-curl', 2, 'skip')), now: () => 'T' });
    expect(r).toMatchObject({ mapped: 1, skipped: 1, alreadyRecorded: 0 });
    expect(readFileSync(r.sqlPath!, 'utf8')).toContain(sha(1));
    const ledger = readFileSync(ledgerPath(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(ledger).toEqual([
      { sha256: sha(1), key: 'hammer-curl', decision: 'map', sortOrder: 100, equipmentConfirmed: false, at: 'T' },
      { sha256: sha(2), key: 'hammer-curl', decision: 'skip', at: 'T' }
    ]);
    const c2 = readFileSync(runCandidates({ workDir: dir }).path, 'utf8');
    expect(c2).not.toContain(sha(1));
    expect(c2.split('\n').filter((l) => l.includes(sha(2)) && l.includes('"hammer-curl"'))).toHaveLength(0);
  });

  it('records nothing and writes no SQL when the CSV is rejected', () => {
    manifest();
    const csv = decide(path.join(dir, 'bad.csv'), row('hammer-curl', 1, 'map'), row('nope', 2, 'map'));
    expect(() => runMapSql({ workDir: dir, csvPath: csv })).toThrow(MappingError);
    expect(existsSync(ledgerPath(dir))).toBe(false);
    expect(existsSync(csv.replace(/\.csv$/, '.map.sql'))).toBe(false);
  });

  it('never overwrites an existing SQL file and leaves the ledger alone when it cannot write', () => {
    manifest();
    const csv = decide(path.join(dir, 'c.csv'), row('hammer-curl', 1, 'map'));
    writeFileSync(csv.replace(/\.csv$/, '.map.sql'), 'keep');
    expect(() => runMapSql({ workDir: dir, csvPath: csv })).toThrow();
    expect(readFileSync(csv.replace(/\.csv$/, '.map.sql'), 'utf8')).toBe('keep');
    expect(existsSync(ledgerPath(dir))).toBe(false);
  });

  it('refuses a different key for an already-mapped video, and tolerates repeating the same decision', () => {
    manifest();
    runMapSql({ workDir: dir, csvPath: decide(path.join(dir, 'a.csv'), row('hammer-curl', 1, 'map')) });
    const before = readFileSync(ledgerPath(dir), 'utf8');
    expect(() => runMapSql({ workDir: dir, csvPath: decide(path.join(dir, 'b.csv'), row('face-pull', 1, 'map')) })).toThrow(/never overwritten/);
    expect(readFileSync(ledgerPath(dir), 'utf8')).toBe(before);
    const again = runMapSql({ workDir: dir, csvPath: decide(path.join(dir, 'c.csv'), row('hammer-curl', 1, 'map')) });
    expect(again.alreadyRecorded).toBe(1);
    expect(readFileSync(ledgerPath(dir), 'utf8')).toBe(before);
  });

  it('a skip-only CSV records the skips and writes no SQL', () => {
    manifest();
    const csv = decide(path.join(dir, 's.csv'), row('hammer-curl', 1, 'skip'));
    const r = runMapSql({ workDir: dir, csvPath: csv });
    expect(r.sqlPath).toBeNull();
    expect(readdirSync(dir).filter((n) => n.endsWith('.sql'))).toEqual([]);
    expect(readFileSync(ledgerPath(dir), 'utf8')).toContain('"skip"');
  });

  it('refuses a damaged ledger', () => {
    manifest();
    mkdirSync(path.join(dir, 'mapping'));
    writeFileSync(ledgerPath(dir), 'oops\n');
    expect(() => runCandidates({ workDir: dir })).toThrow(/damaged/);
    expect(() => runMapSql({ workDir: dir, csvPath: decide(path.join(dir, 'x.csv'), row('hammer-curl', 1, 'map')) })).toThrow(/damaged/);
  });
});

// ---------------------------------------------------------------- the generated SQL, run for real

const read = (f: string) => readFileSync(path.resolve(import.meta.dirname, `../../supabase/migrations/${f}`), 'utf8');

describe('generated SQL against a real Postgres (PGlite, real migrations)', () => {
  let pg: PGlite;
  const q = async (sql: string) => (await pg.query<Record<string, unknown>>(sql)).rows;
  const insert = (n: number, over: Record<string, string> = {}) => {
    const v = { review_status: "'needs_review'", status: "'uploaded'", exercise_key: 'null', match_method: "'none'", tags: "'{}'", ...over };
    return `insert into public.exercise_videos (content_sha256, original_filename, title, storage_key, size_bytes, review_status, status, exercise_key, match_method, tags)
            values ('${sha(n)}', 'v${n}.mp4', 'Video ${n}', 'videos/x/${n}.mp4', 1000, ${v.review_status}, ${v.status}, ${v.exercise_key}, ${v.match_method}, ${v.tags})`;
  };
  const d = (n: number, key: string, p = 'Lib/girl/x.mp4', sort = 100): MapDecision => ({ sha256: sha(n), key, decision: 'map', sortOrder: sort, equipmentConfirmed: false, entryPath: p });
  const state = async () => q('select content_sha256 as s, exercise_key as k, review_status as r, match_method as m, match_confidence::float as c, sort_order as o, tags as t, published as p, title from public.exercise_videos order by content_sha256');
  const at = async (n: number) => (await state()).find((r) => r.s === sha(n))!;

  beforeAll(async () => {
    pg = new PGlite({ extensions: { pg_trgm } });
    await pg.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth; create schema extensions; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
      alter table storage.objects enable row level security;
      grant usage on schema public, auth, storage to anon, authenticated;
    `);
    for (const f of ['20261027010000_exercise_videos_catalog.sql', '20261027010100_exercise_videos_storage.sql', '20261028000000_exercise_videos_published.sql']) await pg.exec(read(f));
  }, 60000);
  afterAll(async () => { await pg.close(); });
  beforeEach(async () => {
    await pg.exec('delete from public.exercise_videos');
    await pg.exec([
      insert(1), insert(2, { review_status: "'unmatched'", tags: "'{existing}'" }),
      insert(3, { review_status: "'matched'", exercise_key: "'barbell-squat'", match_method: "'exact_key'" }),
      insert(4, { review_status: "'rejected'" }), insert(5, { status: "'pending'" }),
      insert(6, { review_status: "'matched'", exercise_key: "'hammer-curl'", match_method: "'manual'" })
    ].join(';') + ';');
  });
  const run = (sql: string) => pg.exec(sql);

  it('maps needs_review and unmatched rows, merges tags, and changes nothing else', async () => {
    const before = await at(1);
    await run(renderMappingSql([d(1, 'hammer-curl'), d(2, 'face-pull', 'Lib/men/y.mp4', 7)], 't'));
    expect(await at(1)).toMatchObject({ k: 'hammer-curl', r: 'matched', m: 'manual', c: 1, o: 100, t: ['demo:female'], p: false, title: before.title });
    expect(await at(2)).toMatchObject({ k: 'face-pull', r: 'matched', m: 'manual', c: 1, o: 7, t: ['demo:male', 'existing'], p: false });
  });

  it('is harmless to run twice, and leaves an already manual same-key row alone', async () => {
    const sql = renderMappingSql([d(1, 'hammer-curl'), d(6, 'hammer-curl')], 't');
    await run(sql);
    const once = await state();
    await run(sql);
    expect(await state()).toEqual(once);
  });

  it('refuses the WHOLE batch when one row is auto-matched, rejected, pending, unknown or manual with another key', async () => {
    const snapshot = await state();
    const cases: Array<[string, MapDecision]> = [
      ['auto-matched', d(3, 'hammer-curl')], ['rejected', d(4, 'hammer-curl')], ['pending', d(5, 'hammer-curl')],
      ['unknown', d(99, 'hammer-curl')], ['manual with another key', d(6, 'face-pull')]
    ];
    for (const [label, bad] of cases) {
      await expect(run(renderMappingSql([d(1, 'hammer-curl'), bad], label)), label).rejects.toThrow(/Nothing changed/);
      expect(await state(), `${label}: nothing may change`).toEqual(snapshot);
    }
  });

  it('never makes a video visible', async () => {
    await run(renderMappingSql([d(1, 'hammer-curl'), d(2, 'face-pull')], 't'));
    expect((await state()).filter((r) => r.p === true)).toEqual([]);
  });
});
