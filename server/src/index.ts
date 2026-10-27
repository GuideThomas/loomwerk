import { createApp } from './app.js';
import { config } from './config.js';
import { getDb } from './db.js';
import { startScheduler } from './engine/scheduler.js';

const db = getDb();
const app = createApp(db);
startScheduler(db);

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
