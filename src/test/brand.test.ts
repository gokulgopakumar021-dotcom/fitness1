// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND } from '../brand';

const root = process.cwd();
const pub = (p: string) => join(root, 'public', p.replace(/^\//, ''));

describe('IRONLOG AI brand assets', () => {
  const manifest = JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8'));

  it('manifest carries the new identity', () => {
    expect(manifest.name).toBe('IronLog AI');
    expect(manifest.short_name).toBe('IronLog');
    expect(manifest.theme_color).toBe('#050505');
    expect(manifest.background_color).toBe('#050505');
  });

  it('every manifest icon exists on disk and includes a maskable one', () => {
    for (const icon of manifest.icons) expect(existsSync(pub(icon.src)), icon.src).toBe(true);
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });

  it('index.html links resolve and use the new name', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain('<title>IRONLOG AI');
    expect(html).not.toMatch(/IRON LOG|Iron Log|Personal Fitness OS/);
    for (const m of html.matchAll(/(?:href|content)="(\/(?:brand\/|favicon|manifest)[^"]*)"/g)) {
      expect(existsSync(pub(m[1])), m[1]).toBe(true);
    }
  });

  it('every BrandLogo asset exists', () => {
    const src = readFileSync(join(root, 'src/components/ui/BrandLogo.tsx'), 'utf8');
    const paths = [...src.matchAll(/src: '(\/brand\/[^']+)'/g)].map((m) => m[1]);
    expect(paths.length).toBe(4);
    for (const p of paths) expect(existsSync(pub(p)), p).toBe(true);
  });

  it('brand constants', () => {
    expect(BRAND.name).toBe('IRONLOG AI');
    expect(BRAND.tagline).toBe('TRAIN SMARTER. BUILD STRONGER.');
  });
});
