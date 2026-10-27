import path from 'node:path';

// All runtime configuration comes from the environment. Secrets (the LLM API
// key) are never persisted to the database or any config file on disk.
export const config = {
  // 7791 sits outside the port ranges Windows reserves for Hyper-V/WinNAT
  // (binding a reserved port "succeeds" but the socket is dead and node
  // exits silently — cost us an evening to figure out).
  port: Number(process.env.LOOMWERK_PORT ?? 7791),
  host: process.env.LOOMWERK_HOST ?? '127.0.0.1',
  dataDir: process.env.LOOMWERK_DATA_DIR ?? path.resolve(process.cwd(), 'data'),
  // Optional bearer token for the API. Empty = open (fine for localhost use;
  // set it as soon as you expose Loomwerk beyond your own machine).
  apiToken: process.env.LOOMWERK_TOKEN ?? '',
  // Extra hostnames the server answers to, comma-separated (a leading dot also
  // covers subdomains). IP literals and localhost always work; anything else —
  // a reverse-proxy domain, a Docker service name — is rejected with 403 to
  // stop DNS rebinding (see http-guard.ts).
  allowedHosts: (process.env.LOOMWERK_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean),
};
