import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDb } from './db.js';
import { apiRouter } from './routes/api.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const db = getDb();
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

app.listen(config.port, config.host, () => {
  console.log(`loomwerk listening on http://${config.host}:${config.port}`);
});
