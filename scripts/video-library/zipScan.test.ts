// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkEntryName, extractEntry, isSuspiciousRatio, looksLikeMp4, sha256OfBuffer, walkZip, type ScanEntry } from './zipScan';
import { buildZip, fakeMp4 } from './zipFixture.testutil';

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'zipscan-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('checkEntryName', () => {
  it.each([
    ['../evil.mp4', 'traversal'],
    ['a/../../evil.mp4', 'traversal'],
    ['a\\..\\evil.mp4', 'traversal (backslash)'],
    ['/etc/passwd.mp4', 'absolute'],
    ['\\\\server\\share\\x.mp4', 'UNC'],
    ['C:\\x.mp4', 'drive letter'],
    ['C:x.mp4', 'drive-relative'],
    ['bad\u0000name.mp4', 'NUL'],
    ['bad\nname.mp4', 'control'],
    ['', 'empty'],
    ['a'.repeat(2000) + '.mp4', 'too long']
  ])('rejects %s (%s)', (name) => {
    expect(checkEntryName(name).ok).toBe(false);
  });
  it('accepts ordinary nested names, including dots and unicode', () => {
    for (const n of ['chest/bench press.mp4', 'a/b/c.v2.mp4', 'Übung/Kreuzheben.mp4', '..hidden/x.mp4', 'x..y.mp4']) expect(checkEntryName(n).ok, n).toBe(true);
  });
});

async function collect(zipPath: string) {
  const out: ScanEntry[] = [];
  await walkZip(zipPath, async (e) => { out.push(e); });
  return out;
}

describe('walkZip + extractEntry', () => {
  it('lists entries, flags symlinks and directories, and extracts with a correct hash', async () => {
    const mp4 = fakeMp4('one');
    const zipPath = path.join(dir, 'ok.zip');
    writeFileSync(zipPath, buildZip([
      { name: 'folder/' },
      { name: 'folder/one.mp4', data: mp4, method: 'deflate' },
      { name: 'folder/link.mp4', data: Buffer.from('target.mp4'), unixMode: 0o120777 }
    ]));
    const entries = await collect(zipPath);
    expect(entries.map((e) => [e.name, e.isDirectory, e.isSymlink])).toEqual([
      ['folder/', true, false], ['folder/one.mp4', false, false], ['folder/link.mp4', false, true]
    ]);
    let got: Awaited<ReturnType<typeof extractEntry>> | undefined;
    await walkZip(zipPath, async (e, zip) => { if (e.name === 'folder/one.mp4') got = await extractEntry(zip, e, dir, 1 << 20); });
    expect(got!.sha256).toBe(sha256OfBuffer(mp4));
    expect(got!.bytes).toBe(mp4.length);
    expect(looksLikeMp4(got!.head)).toBe(true);
    expect(path.basename(got!.filePath)).toMatch(/^e\d+\.part$/);
  });

  it('never writes outside the work dir for a traversal entry name', async () => {
    const outer = mkdtempSync(path.join(tmpdir(), 'outer-'));
    const work = path.join(outer, 'work');
    mkdirSync(work);
    const zipPath = path.join(outer, 'evil.zip');
    writeFileSync(zipPath, buildZip([{ name: '../escaped.mp4', data: fakeMp4('x') }]));
    await walkZip(zipPath, async (e, zip) => {
      expect(checkEntryName(e.name).ok).toBe(false);
      await extractEntry(zip, e, work, 1 << 20); // even if a buggy caller extracted it, the path is generated
    });
    expect(readdirSync(outer).sort()).toEqual(['evil.zip', 'work']);
    expect(readdirSync(work)).toEqual(['e0.part']);
    rmSync(outer, { recursive: true, force: true });
  });

  it('aborts when an entry yields more bytes than its header declares', async () => {
    const zipPath = path.join(dir, 'liar.zip');
    writeFileSync(zipPath, buildZip([{ name: 'liar.mp4', data: fakeMp4('big', 5000), method: 'deflate', declaredSize: 100 }]));
    await expect(walkZip(zipPath, async (e, zip) => { await extractEntry(zip, e, dir, 1 << 20); })).rejects.toThrow(/bytes|size/i);
  });

  it('enforces the byte cap', async () => {
    const zipPath = path.join(dir, 'cap.zip');
    writeFileSync(zipPath, buildZip([{ name: 'a.mp4', data: fakeMp4('cap', 5000) }]));
    await expect(walkZip(zipPath, async (e, zip) => { await extractEntry(zip, e, dir, 100); })).rejects.toThrow(/exceeded/);
  });

  it('flags an extreme compression ratio before anything is extracted', async () => {
    const zipPath = path.join(dir, 'bomb.zip');
    const zeros = Buffer.alloc(8 * 1024 * 1024);
    expect(deflateRawSync(zeros).length * 100).toBeLessThan(zeros.length); // sanity: really is > 100:1
    writeFileSync(zipPath, buildZip([{ name: 'bomb.mp4', data: zeros, method: 'deflate' }, { name: 'fine.mp4', data: fakeMp4('fine') }]));
    const [bomb, fine] = await collect(zipPath);
    expect(isSuspiciousRatio(bomb)).toBe(true);
    expect(isSuspiciousRatio(fine)).toBe(false);
  });

  it('rejects a file that is not an archive', async () => {
    const p = path.join(dir, 'notzip.zip');
    writeFileSync(p, 'definitely not a zip file');
    await expect(walkZip(p, async () => {})).rejects.toThrow();
  });
});

describe('looksLikeMp4', () => {
  it('requires the ftyp box', () => {
    expect(looksLikeMp4(fakeMp4('a'))).toBe(true);
    expect(looksLikeMp4(Buffer.from('this is plain text, not video'))).toBe(false);
    expect(looksLikeMp4(Buffer.alloc(0))).toBe(false);
  });
});
