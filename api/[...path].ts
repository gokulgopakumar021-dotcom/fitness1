// STAGE 1 SPIKE ONLY: catch-all Vercel Function for /api/*.
// Express apps are plain (req, res) request listeners; Vercel invokes the default export.
import { createSpikeApp } from './_spike/app.js';

export default createSpikeApp();
