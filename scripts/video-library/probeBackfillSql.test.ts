// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ManifestRecord } from '../../src/types/video';
import { buildBackfillSql } from './probeBackfillSql';
import { goodMeasurement, probeRecordFor } from './probeSidecar.testutil';

const rec = (sha: string): ManifestRecord => ({ sha256: sha, entryName: `${sha}.mp4`, originalFilename: `${sha}.mp4`, sizeBytes: 10 } as unknown as ManifestRecord);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('buildBackfillSql', () => {
  it('writes one values row per probed video and updates only the three media columns, only where null', () => {
    const { sql, rows } = buildBackfillSql([probeRecordFor(rec(A)), probeRecordFor(rec(B))]);
    expect(rows).toBe(2);
    expect(sql).toContain(`('${A}', 2.50, 1280, 720)`);
    expect(sql).toContain('coalesce(v.duration_seconds, p.duration_seconds)');
    expect(sql).toContain('v.duration_seconds is null or v.width is null or v.height is null');
    const setClause = sql.slice(sql.indexOf('set '), sql.indexOf('from (values'));
    for (const col of ['review_status', 'exercise_key', 'published', 'status']) expect(setClause).not.toContain(col);
  });
  it('skips records that did not probe, have no media, or carry a malformed hash', () => {
    const bad = probeRecordFor(rec(A), { status: 'unreadable', measurement: null });
    const noMedia = probeRecordFor(rec(B), { measurement: { ...goodMeasurement(), durationSeconds: null, video: null } });
    const evil = probeRecordFor(rec("x'); drop table exercise_videos; --"));
    const { sql, rows, skipped } = buildBackfillSql([bad, noMedia, evil]);
    expect(rows).toBe(0);
    expect(skipped).toBe(3);
    expect(sql).toContain('Nothing to update');
    expect(sql).not.toContain('drop table');
  });
  it('uses the latest record per hash', () => {
    const older = probeRecordFor(rec(A), { measurement: { ...goodMeasurement(), durationSeconds: 1 } });
    const newer = probeRecordFor(rec(A), { measurement: { ...goodMeasurement(), durationSeconds: 3 } });
    const { sql, rows } = buildBackfillSql([older, newer]);
    expect(rows).toBe(1);
    expect(sql).toContain(`('${A}', 3.00,`);
  });
});
