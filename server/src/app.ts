import express, { type Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { config } from './config.js';
import { requestGuard } from './http-guard.js';
import { apiRouter } from './routes/api.js';

// The HTTP app without listen() or the scheduler, so tests exercise exactly the
// middleware chain that production runs — a guard that exists but is not
// mounted would pass its own unit tests and protect nothing.
export function createApp(
  db: Database,
  options: { allowedHosts?: readonly string[] } = {},
): Express {
  const app = express();
  // First, before body parsing: a rejected request never touches the API.
  app.use(requestGuard(options.allowedHosts ?? config.allowedHosts));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter(db));

  // Serve the built client if it exists (single-process deployment). During
  // development the Vite dev server proxies /api instead.
  const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}
