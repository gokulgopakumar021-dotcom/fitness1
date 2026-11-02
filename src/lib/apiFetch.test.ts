// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock('./supabase', () => ({ getSupabase: () => ({ auth }) }));

import { apiFetch, resolveApiUrl } from './apiFetch';

const ok = () => new Response('{"success":true}', { status: 200 });
const unauthorized = () => new Response('{"success":false}', { status: 401 });
let fetchMock: ReturnType<typeof vi.fn>;
const headerOf = (call: number, name: string) => new Headers((fetchMock.mock.calls[call][1] as RequestInit).headers).get(name);

beforeEach(() => {
  auth.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok-1' } } });
  auth.refreshSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok-2' } }, error: null });
  fetchMock = vi.fn().mockImplementation(async () => ok());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('apiFetch', () => {
  it('attaches the Supabase access token to internal API calls and preserves body/headers/method', async () => {
    const body = JSON.stringify({ a: 1 });
    await apiFetch('/api/exercise-coach', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Custom': 'k' }, body });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/exercise-coach');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(body);
    expect(headerOf(0, 'authorization')).toBe('Bearer tok-1');
    expect(headerOf(0, 'content-type')).toBe('application/json');
    expect(headerOf(0, 'x-custom')).toBe('k');
  });

  it('returns the original Response untouched so existing .json() handling keeps working', async () => {
    const res = await apiFetch('/api/ai-food-parser', { method: 'POST', body: '{}' });
    expect(await res.json()).toEqual({ success: true });
  });

  it('never attaches the token to external domains or non-API paths', async () => {
    await apiFetch('https://world.openfoodfacts.org/api/v2/product/1.json');
    await apiFetch('https://evil.example/api/steal');
    await apiFetch('/models/pose_landmarker_full.task');
    await apiFetch('//evil.example/api/x');
    for (let i = 0; i < 4; i++) expect(headerOf(i, 'authorization')).toBeNull();
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it('strips a caller-supplied Authorization header when there is no session (server decides: 401)', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await apiFetch('/api/exercise-coach', { headers: { Authorization: 'Bearer stale' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(headerOf(0, 'authorization')).toBeNull();
  });

  it('survives getSession throwing (sends without token)', async () => {
    auth.getSession.mockRejectedValue(new Error('storage unavailable'));
    const res = await apiFetch('/api/exercise-coach');
    expect(res.status).toBe(200);
    expect(headerOf(0, 'authorization')).toBeNull();
  });

  it('on 401 refreshes the session once and retries once with the new token', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized());
    const res = await apiFetch('/api/exercise-coach', { method: 'POST', body: '{"x":1}' });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(headerOf(0, 'authorization')).toBe('Bearer tok-1');
    expect(headerOf(1, 'authorization')).toBe('Bearer tok-2');
  });

  it('does not loop: a second 401 is returned to the caller', async () => {
    fetchMock.mockImplementation(async () => unauthorized());
    const res = await apiFetch('/api/exercise-coach', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry when refresh fails or the body cannot be replayed', async () => {
    fetchMock.mockResolvedValue(unauthorized());
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('x') });
    expect((await apiFetch('/api/a', { method: 'POST', body: '{}' })).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    auth.refreshSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    expect((await apiFetch('/api/a', { method: 'POST', body: new Blob(['x']) })).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses an injected fetch implementation (adaptive-coach client tests rely on this)', async () => {
    const injected = vi.fn().mockResolvedValue(ok());
    await apiFetch('/api/adaptive-coach/explain', { method: 'POST', body: '{}' }, { fetchImpl: injected as unknown as typeof fetch });
    expect(injected).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with VITE_API_BASE_URL only that origin receives the token', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/');
    expect(resolveApiUrl('/api/x')).toBe('https://api.example.test/api/x');
    expect(resolveApiUrl('https://api.example.test/api/x')).toBe('https://api.example.test/api/x');
    expect(resolveApiUrl('https://other.example/api/x')).toBeNull();
    await apiFetch('/api/x');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/api/x');
    expect(headerOf(0, 'authorization')).toBe('Bearer tok-1');
  });
});
