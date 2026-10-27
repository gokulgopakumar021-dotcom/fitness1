import { crc32, deflateRawSync } from 'node:zlib';

/** Minimal ZIP writer for tests, so hostile archives (traversal names, symlinks, lying headers) can be built. */
export interface FixtureEntry {
  name: string;
  data?: Buffer;
  method?: 'store' | 'deflate';
  /** Unix file mode (e.g. 0o120777 for a symlink). */
  unixMode?: number;
  /** Declared uncompressed size when it should differ from the data (lying header). */
  declaredSize?: number;
}

export function buildZip(entries: FixtureEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = e.data ?? Buffer.alloc(0);
    const method = e.method ?? 'store';
    const body = method === 'deflate' ? deflateRawSync(data) : data;
    const declared = e.declaredSize ?? data.length;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // UTF-8 names
    local.writeUInt16LE(method === 'deflate' ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method === 'deflate' ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.unixMode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** Bytes that pass the 'ftyp' container check. `seed` makes each file's hash unique. */
export function fakeMp4(seed: string, padding = 256): Buffer {
  const head = Buffer.alloc(16);
  head.writeUInt32BE(16, 0);
  head.write('ftyp', 4, 'latin1');
  head.write('isom', 8, 'latin1');
  return Buffer.concat([head, Buffer.from(seed), Buffer.alloc(padding, 7)]);
}
