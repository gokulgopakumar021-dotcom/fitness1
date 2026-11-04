import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import { createApp } from './src/server/app';
import { loadSecurityConfig } from './src/server/security';
import { prepareSecurityRuntime } from './src/server/security/runtime';

// `createApp` lives in src/server/app.ts (side-effect free, reused by the Vercel Function). It is re-exported here so
// existing imports of `createApp` from this module keep working.
export { createApp };

dotenv.config();

function getPort(): number {
  const portArgIndex = process.argv.indexOf('--port');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const parsed = Number(process.argv[portArgIndex + 1]);
    if (!isNaN(parsed)) return parsed;
  }
  if (process.env.APP_PORT) {
    return Number(process.env.APP_PORT);
  }
  // The dev container runs Nginx on 8080 and proxies traffic to the app on port 3000.
  return 3000;
}

const PORT = getPort();


async function startServer() {
  // Validates configuration and connects the shared rate-limit store BEFORE accepting traffic. Throws (process exits
  // non-zero) instead of falling back to per-process counters.
  const config = loadSecurityConfig();
  const runtime = await prepareSecurityRuntime(config);
  const app = createApp({ config, rateStore: runtime.rateStore });
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`IRONLOG AI server listening on http://0.0.0.0:${PORT}`);
  });
  const shutdown = () => {
    server.close(() => void runtime.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

// Not started when imported by tests (Vitest sets VITEST).
if (!process.env.VITEST) {
  startServer().catch((err) => {
    // Static/credential-free messages only (see StartupConfigError and prepareSecurityRuntime).
    console.error(`IRONLOG AI refused to start: ${err instanceof Error ? err.message : 'unknown error'}`);
    process.exit(1);
  });
}
