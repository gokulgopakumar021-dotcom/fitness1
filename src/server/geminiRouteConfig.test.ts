// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generate = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generate };
  }
}));

import { createApp } from '../../server';
import { COACH_MAX_OUTPUT_TOKENS } from './app';
import { fakeToken, listen, mockVerifier, testConfig } from './security/testUtils';

/**
 * Stage 3 Gemini reliability: the AI Coach asks for LOW thinking and a bounded output; no route sends the
 * deprecated `temperature` / `top_p` (ignored by Gemini 3.6+, and announced to become a 400 error).
 */
type Srv = Awaited<ReturnType<typeof listen>>;
let srv: Srv | null = null;
let spies: ReturnType<typeof vi.spyOn>[] = [];

async function post(path: string, body: unknown) {
  const res = await fetch(`${srv!.base}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fakeToken()}` },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe('Gemini request configuration per route', () => {
  beforeEach(async () => {
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    generate.mockReset();
    spies = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'log').mockImplementation(() => {})];
    const app: Express = createApp({ verifyToken: mockVerifier, config: testConfig({ rateUserPerMin: 10_000, rateIpPerMin: 10_000 }) });
    srv = await listen(app);
  });
  afterEach(async () => {
    spies.forEach((s) => s.mockRestore());
    await srv?.close();
    srv = null;
  });

  it('17. AI Coach: thinkingLevel LOW, bounded maxOutputTokens, system instruction and prompt intact, no temperature', async () => {
    generate.mockResolvedValue({ text: '- Brace your core.' });
    const r = await post('/ai-personal-trainer', {
      messages: [{ role: 'user', text: 'first question' }, { role: 'model', text: 'first answer' }],
      userMessage: 'second question',
      profile: { name: 'A', primaryGoal: 'Muscle Gain' },
      activeSession: null,
      bluetooth: { isConnected: false },
      mirrorInsights: []
    });
    expect(r.status).toBe(200);
    expect(r.json.reply).toBe('- Brace your core.');
    expect(generate).toHaveBeenCalledTimes(1);
    const arg = generate.mock.calls[0][0];
    expect(arg.model).toBe('gemini-3.8-flash'); // primary model unchanged
    expect(arg.config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' }); // supported by 3.8 and 3.6 Flash; MINIMAL would be rejected by 3.8
    expect(arg.config.maxOutputTokens).toBe(COACH_MAX_OUTPUT_TOKENS);
    expect(COACH_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(2048); // thinking tokens count against it; never starve the reply
    expect(COACH_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(8192);
    expect(arg.config.systemInstruction).toContain('Coach Iron');
    expect(arg.config.systemInstruction).toContain('Keep answers concise, actionable, and formatted with clean bullet points.');
    expect(arg.config).not.toHaveProperty('temperature');
    expect(arg.config).not.toHaveProperty('topP');
    expect(arg.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']); // history format unchanged
  });

  it('other AI routes are untouched: no thinkingConfig, no maxOutputTokens, no temperature', async () => {
    generate.mockResolvedValue({ text: JSON.stringify({ items: [] }) });
    await post('/ai-food-parser', { query: '2 eggs', mealCategory: 'breakfast' });
    expect(generate).toHaveBeenCalledTimes(1);
    const cfg = generate.mock.calls[0][0].config;
    expect(cfg.responseMimeType).toBe('application/json'); // other generation settings preserved
    for (const key of ['thinkingConfig', 'maxOutputTokens', 'temperature', 'topP', 'top_p']) expect(cfg).not.toHaveProperty(key);
  });

  it('no Gemini call site in app.ts sets temperature or top_p, and exactly one sets thinkingConfig (the AI Coach)', () => {
    const src = readFileSync(new URL('./app.ts', import.meta.url), 'utf8');
    const calls = src.match(/ai\.models\.generateContent\(/g) ?? [];
    expect(calls.length).toBe(15); // all 15 AI routes inspected
    expect(src).not.toMatch(/\btemperature\s*:/);
    expect(src).not.toMatch(/\btop_?[pP]\s*:/);
    expect(src.match(/thinkingConfig\s*:/g)).toHaveLength(1);
    expect(src.match(/maxOutputTokens\s*:/g)).toHaveLength(1);
    const trainer = src.slice(src.indexOf("app.post('/api/ai-personal-trainer'"), src.indexOf("app.post('/api/adaptive-coach/explain'"));
    expect(trainer).toContain("thinkingLevel: 'LOW'");
  });
});
