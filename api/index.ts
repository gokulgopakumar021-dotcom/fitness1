// STAGE 1 SPIKE ONLY: single Vercel Function for /api and /api/* (via the scoped rewrite in vercel.json).
// Express apps are plain (req, res) request listeners; Vercel invokes the default export.
import { createSpikeApp } from './_spike/app.js';

export default createSpikeApp();
