import { describe, expect, it } from 'vitest';
import { loadSecurityConfig } from './config';
import { QUOTA_ENV } from './testUtils';

const REDIS = 'rediss://:pw@cache.example.com:6380';

describe('rate-store configuration', () => {
  it('development defaults to memory with no problems', () => {
    const c = loadSecurityConfig({ NODE_ENV: 'development' });
    expect(c).toMatchObject({ rateStore: 'memory', rateFailurePolicy: 'closed', problems: [], warnings: [] });
  });

  it('production defaults to redis and demands REDIS_URL', () => {
    const c = loadSecurityConfig({ NODE_ENV: 'production', ...QUOTA_ENV });
    expect(c.rateStore).toBe('redis');
    expect(c.problems.join(' ')).toMatch(/REDIS_URL is required/);
  });

  it('production with a valid Redis URL has no problems; the URL is kept out of problem text', () => {
    const c = loadSecurityConfig({ NODE_ENV: 'production', ...QUOTA_ENV, REDIS_URL: REDIS });
    expect(c.problems).toEqual([]);
    expect(c.redisUrl).toBe(REDIS);
  });

  it('production memory must be chosen explicitly and warns', () => {
    const c = loadSecurityConfig({ NODE_ENV: 'production', ...QUOTA_ENV, RATE_LIMIT_STORE: 'memory' });
    expect(c.rateStore).toBe('memory');
    expect(c.problems).toEqual([]);
    expect(c.warnings.join(' ')).toMatch(/not shared between instances/);
  });

  it.each([
    [{ RATE_LIMIT_STORE: 'mongo' }, /RATE_LIMIT_STORE/],
    [{ RATE_LIMIT_STORE: 'redis', REDIS_URL: 'http://x' }, /redis:\/\/ or rediss:\/\//],
    [{ RATE_LIMIT_STORE: 'redis', REDIS_URL: '' }, /REDIS_URL is required/],
    [{ RATE_LIMIT_FAILURE_POLICY: 'open' }, /RATE_LIMIT_FAILURE_POLICY/]
  ])('rejects %j', (env, re) => {
    expect(loadSecurityConfig({ NODE_ENV: 'production', ...QUOTA_ENV, REDIS_URL: REDIS, ...env }).problems.join(' ')).toMatch(re);
  });

  it('values are case-insensitive and trimmed; an unset or empty policy means closed', () => {
    expect(loadSecurityConfig({ NODE_ENV: 'production', ...QUOTA_ENV, REDIS_URL: REDIS, RATE_LIMIT_FAILURE_POLICY: ' Degraded ' }).rateFailurePolicy).toBe('degraded');
    expect(loadSecurityConfig({ NODE_ENV: 'production', ...QUOTA_ENV, REDIS_URL: REDIS, RATE_LIMIT_FAILURE_POLICY: '' }).rateFailurePolicy).toBe('closed');
    expect(loadSecurityConfig({ NODE_ENV: 'development', RATE_LIMIT_STORE: ' REDIS ', REDIS_URL: REDIS }).rateStore).toBe('redis');
  });

  it('warns about plaintext redis:// to a remote host in production but not to localhost', () => {
    expect(loadSecurityConfig({ NODE_ENV: 'production', ...QUOTA_ENV, REDIS_URL: 'redis://cache.internal:6379' }).warnings.join(' ')).toMatch(/TLS/);
    expect(loadSecurityConfig({ NODE_ENV: 'production', ...QUOTA_ENV, REDIS_URL: 'redis://localhost:6379' }).warnings).toEqual([]);
    expect(loadSecurityConfig({ NODE_ENV: 'production', ...QUOTA_ENV, REDIS_URL: 'redis://:pw@127.0.0.1:6379' }).warnings).toEqual([]);
  });

  it('degraded policy and REDIS_URL are flagged as ineffective with the memory store', () => {
    const w = loadSecurityConfig({ NODE_ENV: 'development', RATE_LIMIT_STORE: 'memory', REDIS_URL: REDIS, RATE_LIMIT_FAILURE_POLICY: 'degraded' }).warnings.join(' ');
    expect(w).toMatch(/Redis will not be used/);
    expect(w).toMatch(/no effect/);
  });
});
