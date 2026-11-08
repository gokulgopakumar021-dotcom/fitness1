// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger, redact, scrubString } from './logger';

afterEach(() => vi.restoreAllMocks());

describe('SEC-09 structured logging redaction', () => {
  it('redacts sensitive keys and token-shaped strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlMTIz';
    const out = redact({ authorization: `Bearer ${jwt}`, apiKey: 'AIzaSyFAKEFAKEFAKEFAKEFAKE12345', nested: { password: 'p', note: `jwt ${jwt}` }, ok: 'fine' }) as any;
    expect(out.authorization).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
    expect(out.nested.password).toBe('[redacted]');
    expect(out.nested.note).toBe('jwt [redacted-jwt]');
    expect(out.ok).toBe('fine');
  });

  it('scrubs keys inside free text and URLs and truncates long strings', () => {
    expect(scrubString('call https://x.test/v1?key=SECRETVALUE&a=1 with AIzaSyFAKEFAKEFAKEFAKEFAKE12345')).not.toMatch(/SECRETVALUE|AIzaSy/);
    expect(scrubString('sb_secret_abcdef123456')).toBe('[redacted-key]');
    expect(scrubString('a'.repeat(5000)).length).toBeLessThan(600);
  });

  it('scrubs an HTTP Basic credential and a Razorpay key id that appear inside free text', () => {
    const basic = Buffer.from('rzp_test_abc123XYZ:some_key_secret_value').toString('base64');
    const out = scrubString(`request failed, Authorization: Basic ${basic}, key rzp_test_abc123XYZ`);
    expect(out).not.toContain(basic);
    expect(out).not.toMatch(/rzp_test_abc123XYZ/);
    expect(out).toContain('Basic [redacted]');
    expect(scrubString('Basic is the word, not a credential')).toBe('Basic is the word, not a credential');
  });

  it('emits one JSON line per event and respects LOG_LEVEL', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('LOG_LEVEL', 'warn');
    logger.info('hidden', {});
    expect(spy).not.toHaveBeenCalled();
    vi.stubEnv('LOG_LEVEL', 'info');
    logger.info('shown', { requestId: 'r1', token: 'abc' });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: 'info', event: 'shown', requestId: 'r1', token: '[redacted]' });
    vi.unstubAllEnvs();
  });
});
