// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Stage 9 / V7 guard. The repo's supabase/migrations must stay identical, by version AND name, to the hosted project's
 * schema_migrations history (verified read-only 2026-11-13: 16 rows). A mismatch is dangerous: `supabase db push --include-all`
 * would replay migrations that already ran. This test fails on drift; it never touches a database.
 *
 * When a migration is legitimately added (applied to the project first, so the CLI records its real version), append it to
 * REMOTE_HISTORY in the SAME commit. Never edit an existing row to make the test pass: reconcile the files instead
 * (docs/deployment/MIGRATION_HISTORY_RECONCILIATION.md).
 */
const repo = resolve(import.meta.dirname, '../..');
const migDir = join(repo, 'supabase/migrations');

/** Remote migration history, in the order it actually executed. */
export const REMOTE_HISTORY: ReadonlyArray<readonly [string, string]> = [
  ['20261027051824', 'auth_profiles'],
  ['20261027063157', 'exercise_videos_catalog'],
  ['20261027064620', 'exercise_videos_storage'],
  ['20261028053743', 'exercise_videos_published'],
  ['20261030053401', 'delete_own_account'],
  ['20261102045148', 'ai_usage_quota'],
  ['20261102082840', 'revoke_rls_auto_enable_execute'],
  ['20261103061647', 'ai_quota_bucket_allowlist'],
  ['20261105071106', 'workout_cloud_sync'],
  ['20261105072929', 'workout_sync_no_client_delete'],
  ['20261106052859', 'billing_core'],
  ['20261106071858', 'billing_deletion_refund'],
  ['20261112060134', 'legal_acceptances'],
  ['20261112060254', 'referral_core'],
  ['20261113043228', 'legal_acceptance_enforcement'],
  ['20261113043241', 'age_eligibility']
];

/** Local-only versions the repo used BEFORE reconciliation. They never existed on the project; nothing live may cite them. */
const STALE_VERSIONS = [
  '20261027000000', '20261027010000', '20261027010100', '20261028000000', '20261030000000', '20261031000000', '20261103000000',
  '20261106000000', '20261106100000', '20261110000000', '20261111000000', '20261112000000', '20261112100000'
];

/** Dated, point-in-time reports that correctly describe the repo as it was. They are frozen on purpose and may cite stale versions. */
const FROZEN_HISTORICAL_DOCS = [
  'IRONLOG_AI_SECURITY_REMEDIATION_REPORT.md',
  'docs/VERCEL_BACKEND_COMPATIBILITY_AUDIT.md',
  'docs/deployment/CROSS_DEVICE_SYNC_IMPLEMENTATION_REPORT.md',
  'docs/deployment/VERCEL_STAGE_2_BACKEND_READINESS_AUDIT.md',
  'docs/internal-security/IRONLOG_AI_SECURITY_AUDIT_96df0356.md',
  'docs/internal-security/IRONLOG_AI_SECURITY_REMEDIATION_REPORT_78d279a7.md',
  'docs/internal-security/REMEDIATION_SESSION_2.md',
  'docs/legal/STAGE_2B_IMPLEMENTATION_REPORT.md'
];
const RECONCILIATION_DOC = 'docs/deployment/MIGRATION_HISTORY_RECONCILIATION.md';
const SELF = 'src/test/migrationHistory.guard.test.ts';

const files = readdirSync(migDir).sort();
const parsed = files.map((f) => {
  const m = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(f);
  return { file: f, version: m?.[1] ?? '', name: m?.[2] ?? '' };
});

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.vercel']);
const TEXT_EXT = /\.(md|ts|tsx|js|mjs|cjs|json|sql|toml|ya?ml|example|txt)$/;
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(e) || e === '.env.example') out.push(p);
  }
  return out;
}
const allText = walk(repo).map((p) => ({ rel: relative(repo, p).split('\\').join('/'), text: readFileSync(p, 'utf8') }));

describe('supabase/migrations matches the hosted migration history', () => {
  it('every file is named <14-digit version>_<snake_name>.sql with no stray files', () => {
    expect(parsed.filter((p) => !p.version).map((p) => p.file)).toEqual([]);
  });
  it('has no duplicate versions and no duplicate names', () => {
    const versions = parsed.map((p) => p.version);
    const names = parsed.map((p) => p.name);
    expect(versions.filter((v, i) => versions.indexOf(v) !== i)).toEqual([]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
  it('equals the remote history exactly: same versions, same names, same order (nothing missing, nothing extra)', () => {
    expect(parsed.map((p) => [p.version, p.name])).toEqual(REMOTE_HISTORY.map(([v, n]) => [v, n]));
  });
  it('keeps the remote history itself strictly ordered by version', () => {
    const v = REMOTE_HISTORY.map(([x]) => x);
    expect(v).toEqual([...v].sort());
  });
  it('contains the remote-only revoke migration with exactly the remote SQL, still guarded', () => {
    const f = join(migDir, '20261102082840_revoke_rls_auto_enable_execute.sql');
    expect(existsSync(f)).toBe(true);
    const norm = readFileSync(f, 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
    expect(norm).toBe(
      "do $$ begin if to_regprocedure('public.rls_auto_enable()') is not null then revoke execute on function public.rls_auto_enable() from public, anon, authenticated; end if; end $$;"
    );
  });
});

describe('dependency order', () => {
  const idx = (name: string) => parsed.findIndex((p) => p.name === name);
  it.each([
    ['auth_profiles', 'delete_own_account'],
    ['exercise_videos_catalog', 'exercise_videos_storage'],
    ['exercise_videos_storage', 'exercise_videos_published'],
    ['ai_usage_quota', 'ai_quota_bucket_allowlist'],
    ['workout_cloud_sync', 'workout_sync_no_client_delete'],
    ['billing_core', 'billing_deletion_refund'],
    ['legal_acceptances', 'legal_acceptance_enforcement'],
    ['legal_acceptance_enforcement', 'age_eligibility'],
    // The actual remote execution order, the reverse of the pre-reconciliation local order.
    ['legal_acceptances', 'referral_core']
  ])('%s runs before %s', (a, b) => {
    expect(idx(a)).toBeGreaterThanOrEqual(0);
    expect(idx(a)).toBeLessThan(idx(b));
  });
  it('never uses a public table before the migration that creates it (references / alter table)', () => {
    const created = new Map<string, number>();
    parsed.forEach((p, i) => {
      const sql = readFileSync(join(migDir, p.file), 'utf8').replace(/--[^\n]*/g, '');
      for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)) if (!created.has(m[1])) created.set(m[1], i);
    });
    const violations: string[] = [];
    parsed.forEach((p, i) => {
      const sql = readFileSync(join(migDir, p.file), 'utf8').replace(/--[^\n]*/g, '');
      const used = new Set<string>();
      for (const m of sql.matchAll(/references\s+public\.([a-z0-9_]+)/gi)) used.add(m[1]);
      for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.([a-z0-9_]+)/gi)) used.add(m[1]);
      for (const t of used) {
        const at = created.get(t);
        if (at === undefined) violations.push(`${p.file}: ${t} is never created by any migration`);
        else if (at > i) violations.push(`${p.file}: uses ${t} before ${parsed[at].file} creates it`);
      }
    });
    expect(violations).toEqual([]);
  });
  it('keeps proposed (unapproved) migrations out of supabase/migrations and newer than the newest applied version', () => {
    const dir = join(repo, 'supabase/proposed');
    if (!existsSync(dir)) return;
    const newest = parsed[parsed.length - 1].version;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
      expect(files).not.toContain(f);
      expect(f.slice(0, 14) > newest).toBe(true);
    }
  });
});

describe('stale versions and prohibited commands', () => {
  it('no live file cites a pre-reconciliation local version (only frozen dated reports and the reconciliation doc/test may)', () => {
    const allowed = new Set([...FROZEN_HISTORICAL_DOCS, RECONCILIATION_DOC, SELF]);
    const hits = allText
      .filter((f) => !allowed.has(f.rel))
      .flatMap((f) => STALE_VERSIONS.filter((v) => f.text.includes(v)).map((v) => `${f.rel}: ${v}`));
    expect(hits).toEqual([]);
  });
  it('the frozen-report allowlist has no dead entries (each still cites a stale version), so it cannot silently grow stale', () => {
    for (const rel of FROZEN_HISTORICAL_DOCS) {
      const f = allText.find((x) => x.rel === rel);
      expect(f, `${rel} missing; remove it from FROZEN_HISTORICAL_DOCS`).toBeDefined();
      expect(STALE_VERSIONS.some((v) => f!.text.includes(v)), `${rel} no longer cites a stale version; remove it from the allowlist`).toBe(true);
    }
  });
  it('no pre-reconciliation migration file name exists on disk', () => {
    expect(files.filter((f) => STALE_VERSIONS.some((v) => f.startsWith(v)))).toEqual([]);
  });
  it('no live file instructs `supabase migration repair|revert` or `db push --include-all` (the reconciliation doc may name them only as prohibited)', () => {
    const re = /supabase\s+migration\s+(repair|revert)|--include-all/i;
    const offenders: string[] = [];
    for (const f of allText) {
      if (f.rel === SELF || FROZEN_HISTORICAL_DOCS.includes(f.rel)) continue;
      f.text.split('\n').forEach((line, i) => {
        if (!re.test(line)) return;
        const prohibited = f.rel === RECONCILIATION_DOC && /do not|never|must not|prohibited|forbidden/i.test(line);
        if (!prohibited) offenders.push(`${f.rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
