import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDb } from './db.js';
import { apiRouter } from './routes/api.js';
import { startScheduler } from './engine/scheduler.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const db = getDb();
app.use('/api', apiRouter(db));
startScheduler(db);

// Serve the built client if it exists (single-process deployment). During
// development the Vite dev server proxies /api instead.
const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Express 5 calls this callback on failure too, with the error as argument.
// Ignoring it printed "listening" and then exited silently with code 0 —
// e.g. when Windows reserves the port range (Hyper-V/WinNAT excluded ports).
app.listen(config.port, config.host, (error?: Error) => {
  if (error) {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(`loomwerk could not listen on ${config.host}:${config.port}: ${error.message}`);
    if (code === 'EACCES' || code === 'EADDRINUSE') {
      console.error(
        'Choose another port with LOOMWERK_PORT. On Windows, reserved ranges are listed by ' +
          '`netsh interface ipv4 show excludedportrange protocol=tcp`.',
      );
    }
    process.exit(1);
  }
  console.log(`loomwerk listening on http://${config.host}:${config.port}`);
});
