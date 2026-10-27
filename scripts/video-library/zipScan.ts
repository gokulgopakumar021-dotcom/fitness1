import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

/**
 * Safe, streaming ZIP reading for the video library tools.
 *
 * Safety model:
 *  - Archive entry names are LABELS ONLY. They are validated and recorded, but never joined into a filesystem
 *    path: extraction always writes to a name this code generates (`e<index>.part`) inside a work directory.
 *  - Names with `..` segments, absolute paths, drive letters, UNC prefixes, NUL or control characters are
 *    reported as unsafe and never read. Symlink entries are never read.
 *  - Extraction is size-bounded: it aborts if the stream produces more bytes than the entry declared.
 *  - Entries with an extreme compression ratio are flagged as possible zip bombs and not extracted.
 */

export const MAX_RATIO = 100;
export const RATIO_MIN_BYTES = 1024 * 1024;

export type NameCheck = { ok: true } | { ok: false; reason: string };

export function checkEntryName(name: string): NameCheck {
  if (!name) return { ok: false, reason: 'empty name' };
  if (name.length > 1024) return { ok: false, reason: 'name too long' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, reason: 'control character in name' };
  if (name.startsWith('/') || name.startsWith('\\')) return { ok: false, reason: 'absolute or UNC path' };
  if (/^[A-Za-z]:/.test(name)) return { ok: false, reason: 'drive-letter path' };
  if (name.split(/[\\/]+/).some((seg) => seg === '..')) return { ok: false, reason: 'path traversal segment' };
  return { ok: true };
}

export interface ScanEntry {
  index: number;
  name: string;
  declaredSize: number;
  compressedSize: number;
  crc32: number;
  isDirectory: boolean;
  isSymlink: boolean;
  raw: yauzl.Entry;
}

function decodeName(raw: yauzl.Entry): string {
  const buf = raw.fileName as unknown as Buffer;
  // General-purpose flag bit 11 means UTF-8; otherwise the spec says CP437, approximated here as latin1.
  return buf.toString((raw.generalPurposeBitFlag & 0x800) !== 0 ? 'utf8' : 'latin1');
}

function toScanEntry(raw: yauzl.Entry, index: number): ScanEntry {
  const name = decodeName(raw);
  const unix = (raw.versionMadeBy >> 8) === 3;
  const mode = unix ? (raw.externalFileAttributes >>> 16) & 0xffff : 0;
  return {
    index,
    name,
    declaredSize: raw.uncompressedSize,
    compressedSize: raw.compressedSize,
    crc32: raw.crc32,
    isDirectory: name.endsWith('/') || name.endsWith('\\'),
    isSymlink: (mode & 0xf000) === 0xa000,
    raw
  };
}

export function isSuspiciousRatio(e: Pick<ScanEntry, 'declaredSize' | 'compressedSize'>): boolean {
  if (e.declaredSize < RATIO_MIN_BYTES) return false;
  if (e.compressedSize === 0) return true;
  return e.declaredSize / e.compressedSize > MAX_RATIO;
}

/** Calls `handler` for every entry, one at a time, in archive order. A thrown error stops the walk. */
export function walkZip(zipPath: string, handler: (entry: ScanEntry, zip: yauzl.ZipFile) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, decodeStrings: false }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('could not open archive'));
      let index = 0;
      zip.on('error', reject);
      zip.on('end', () => resolve());
      zip.on('entry', (raw: yauzl.Entry) => {
        handler(toScanEntry(raw, index++), zip).then(
          () => zip.readEntry(),
          (e) => { zip.close(); reject(e); }
        );
      });
      zip.readEntry();
    });
  });
}

export interface Extracted {
  filePath: string;
  sha256: string;
  bytes: number;
  head: Buffer;
}

/**
 * Streams one entry into `<workDir>/e<index>.part`, hashing as it goes. Throws if the entry yields more than
 * `declaredSize` bytes (bomb / lying header) or exceeds `maxBytes`. The destination name never derives from
 * the entry name.
 */
export async function extractEntry(zip: yauzl.ZipFile, entry: ScanEntry, workDir: string, maxBytes: number): Promise<Extracted> {
  const filePath = path.join(workDir, `e${entry.index}.part`);
  const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zip.openReadStream(entry.raw, (err, s) => (err || !s ? reject(err ?? new Error('could not open entry')) : resolve(s)));
  });
  const hash = createHash('sha256');
  let bytes = 0;
  let head = Buffer.alloc(0);
  const limit = Math.min(entry.declaredSize, maxBytes);
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > limit) return cb(new Error(`entry exceeded its declared size (${limit} bytes)`));
      if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
      hash.update(chunk);
      cb(null, chunk);
    }
  });
  await pipeline(stream, meter, createWriteStream(filePath, { flags: 'w', mode: 0o600 }));
  return { filePath, sha256: hash.digest('hex'), bytes, head };
}

/** True when the first bytes look like an ISO base media file (MP4/MOV family): 'ftyp' at offset 4. */
export function looksLikeMp4(head: Buffer): boolean {
  return head.length >= 8 && head.subarray(4, 8).toString('latin1') === 'ftyp';
}

export function sha256OfBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
