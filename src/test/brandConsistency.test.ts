// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BRAND } from '../brand';
import { LEGAL } from '../legal/legalConfig';

/**
 * Stage 2D / Stage 5: one approved public spelling, "Iron Log AI", everywhere users can see it.
 * Internal identifiers (`ironlog_*` storage keys, the ironlog.app domain, file names) are deliberately NOT covered:
 * they stay as they are so existing user data keeps loading.
 */
const root = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const isTest = (p: string) => /\.test\.(ts|tsx)$/.test(p);
const sourceFiles = walk(join(root, 'src')).filter((p) => /\.(ts|tsx|css)$/.test(p) && !isTest(p));
const surfaceFiles = ['index.html', 'metadata.json', 'capacitor.config.ts', 'public/manifest.webmanifest', 'README.md'].map((f) => join(root, f));

/**
 * Old one-word brand spellings: "IronLog AI", "IRONLOG AI", a bare "IronLog" or a bare "IRONLOG".
 * A longer code identifier that merely starts with the word (the `IronLogDB` class, an `IRONLOG_*` constant) is not
 * brand text and is not matched.
 */
const STALE = /IronLog(?![A-Za-z0-9_])|IRONLOG(?![A-Za-z0-9_])|Ironlog/;

/**
 * The only two places that may keep a one-word `IronLog`/`IRONLOG` form, each for a technical reason:
 * - the backup-file format marker (`app: 'IRONLOG AI'`), a data identifier older exports already carry;
 * - the User-Agent string sent to an external API.
 */
const isTechnicalIdentifier = (line: string) => /app: 'IRONLOG AI'/.test(line) || /User-Agent/.test(line);

describe('Iron Log AI brand consistency', () => {
  it('no app source, style or UI file uses a pre-Stage-5 spelling', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (STALE.test(line) && !isTechnicalIdentifier(line)) offenders.push(`${relative(root, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('page metadata, manifest, native app name and README use the approved spelling', () => {
    for (const f of surfaceFiles) {
      const text = readFileSync(f, 'utf8');
      expect(text, relative(root, f)).not.toMatch(STALE);
    }
    expect(readFileSync(surfaceFiles[0], 'utf8')).toContain('<meta property="og:site_name" content="Iron Log AI" />');
    expect(readFileSync(surfaceFiles[2], 'utf8')).toContain("appName: 'Iron Log AI'");
  });

  it('the legal pages and the app share one spelling', () => {
    expect(LEGAL.brandName).toBe('Iron Log AI');
    expect(BRAND.name).toBe(LEGAL.brandName);
    expect(BRAND.proseName).toBe(LEGAL.brandName);
    expect(BRAND.shortName).toBe(LEGAL.brandName);
    expect(BRAND.wordmark).toBe(LEGAL.brandName.toUpperCase());
  });

  it('the intentional technical identifiers are unchanged', () => {
    expect(readFileSync(join(root, 'src/storage/db.ts'), 'utf8')).toContain("app: 'IRONLOG AI'");
    expect(LEGAL.supportEmail).toBe('support@ironlog.app');
  });

  it('the sign-up payload carries no client timestamp (database clock only)', () => {
    const offenders = sourceFiles.filter((f) => /accepted_at_client|acceptedAtClient/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });
});
