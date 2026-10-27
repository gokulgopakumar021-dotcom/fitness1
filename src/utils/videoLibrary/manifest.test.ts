import { describe, expect, it } from 'vitest';
import type { ManifestRecord } from '../../types/video';
import { ManifestError, parseManifest, storageKeyFor, validateManifestRecord } from './manifest';

const SHA = 'a'.repeat(64);
const good = (over: Partial<ManifestRecord> = {}): ManifestRecord => ({
  entryIndex: 0, entryName: 'x/curl.mp4', originalFilename: 'curl.mp4', crc32: 1, declaredSize: 10, status: 'ok', sha256: SHA, sizeBytes: 10,
  probe: 'ok', durationSeconds: 3.2, width: 640, height: 360, title: 'Curl', match: null, ...over
});

describe('validateManifestRecord', () => {
  it('accepts a complete record', () => {
    expect(validateManifestRecord(good()).title).toBe('Curl');
  });
  it('rejects malformed hashes, sizes and statuses', () => {
    expect(() => validateManifestRecord(good({ sha256: 'xyz' }))).toThrow(ManifestError);
    expect(() => validateManifestRecord(good({ sizeBytes: 0 }))).toThrow(/positive sizeBytes/);
    expect(() => validateManifestRecord({ ...good(), status: 'weird' })).toThrow(/status/);
    expect(() => validateManifestRecord(good({ durationSeconds: -1 }))).toThrow(/durationSeconds/);
    expect(() => validateManifestRecord(null)).toThrow(ManifestError);
  });
  it('requires an exercise key on a matched record and duplicateOf on a duplicate', () => {
    const bad = { method: 'exact_key', reviewStatus: 'matched', confidence: 1, exerciseKey: null, suggestedKey: null, reason: 'ok', candidates: [] };
    expect(() => validateManifestRecord(good({ match: bad as never }))).toThrow(/exerciseKey/);
    expect(() => validateManifestRecord(good({ status: 'duplicate' }))).toThrow(/duplicateOf/);
  });
});

describe('parseManifest', () => {
  it('keeps good lines and reports bad ones without throwing', () => {
    const text = [JSON.stringify(good()), '{not json', JSON.stringify({ ...good(), sha256: 'bad' }), '', JSON.stringify(good({ entryIndex: 1, entryName: 'b.mp4' }))].join('\n');
    const { records, errors } = parseManifest(text);
    expect(records).toHaveLength(2);
    expect(errors.map((e) => e.line)).toEqual([2, 3]);
  });
});

describe('storageKeyFor', () => {
  it('is content-addressed and rejects non-hashes', () => {
    expect(storageKeyFor(SHA)).toBe(`videos/aa/${SHA}.mp4`);
    expect(() => storageKeyFor('../../etc/passwd')).toThrow(ManifestError);
  });
});
