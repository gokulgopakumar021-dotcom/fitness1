// SOURCE of the Vercel Function entry point for /api and /api/* (reached through the scoped rewrite in vercel.json).
// Vercel runs the esbuild bundle of this file, committed as api/index.js (scripts/bundle-api.mjs, `npm run build:api`).
// Vercel invokes the default export with a Node (req, res) pair. All behaviour lives in src/server/serverless/*;
// this file only wires the real per-instance application provider to the handler.
// It must stay minimal: nothing here may listen, import the local runner (server.ts) or Vite, or touch process signals.
import { getApp } from './getApp';
import { createHandler } from './handler';

export default createHandler(getApp);
