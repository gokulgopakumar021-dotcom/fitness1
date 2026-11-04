// Vercel Function entry point for /api and /api/* (reached through the scoped rewrite in vercel.json).
// Vercel invokes the default export with a Node (req, res) pair. All behaviour lives in src/server/serverless/*;
// this file only wires the real per-instance application provider to the handler.
// It must stay minimal: nothing here may listen, import the local runner (server.ts) or Vite, or touch process signals.
import { getApp } from '../src/server/serverless/getApp.js';
import { createHandler } from '../src/server/serverless/handler.js';

export default createHandler(getApp);
