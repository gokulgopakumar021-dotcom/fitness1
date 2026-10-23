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
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
