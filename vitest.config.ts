import path from 'path';
import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts, which must not be modified (AI Studio HMR note).
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    restoreMocks: true,
    // The production default is FAIL CLOSED ("on"). Legacy suites that boot the app without billing config and test unrelated behaviour
    // (schemas, rate limits, age gate...) opt out explicitly here. Billing/entitlement suites pass their own config, and
    // accessControl.test.ts proves the real default by deleting this variable.
    env: { BILLING_ENFORCEMENT: 'off' },
  },
});
