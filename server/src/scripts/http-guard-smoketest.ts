// HTTP guard smoke test — DNS rebinding (Host allowlist) and cross-site
// requests (Origin / Sec-Fetch-Site) against the real app from createApp(), on
// an ephemeral loopback port with an in-memory database. Every blocking case
// has a positive control next to it: a guard that rejects everything would
// fail those, a guard that is not mounted would fail the blocking ones.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

// The API must be open (no token) and the cycle route must answer 409 "no
// provider" — that 409 is how a request proves it got past the guard.
for (const key of [
  'LOOMWERK_TOKEN',
  'LOOMWERK_ALLOWED_HOSTS',
  'LOOMWERK_LLM_BASE_URL',
  'LOOMWERK_LLM_API_KEY',
]) {
  delete process.env[key];
}
const { createApp } = await import('../app.js');
const { openTestDb } = await import('../db.js');
const { hostnameFromHostHeader, isAllowedHostname } = await import('../http-guard.js');

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok   ${name}`);
    })
    .catch((e: Error) => {
      failed++;
      console.error(`  FAIL ${name}: ${e.message}`);
    });
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

console.log('http guard smoke test');

await check('host header parsing', () => {
  assert(hostnameFromHostHeader('localhost:7791') === 'localhost', 'localhost:port');
  assert(hostnameFromHostHeader('LOCALHOST.') === 'localhost', 'case + trailing dot');
  assert(hostnameFromHostHeader('127.0.0.1:7791') === '127.0.0.1', 'ipv4');
  assert(hostnameFromHostHeader('[::1]:7791') === '::1', 'ipv6');
  assert(hostnameFromHostHeader('evil.test@localhost') === null, 'userinfo rejected');
  assert(hostnameFromHostHeader('localhost/x') === null, 'path rejected');
  assert(hostnameFromHostHeader('[::1]x') === null, 'garbage after ipv6');
});

await check('hostname allowlist', () => {
  for (const h of ['localhost', '127.0.0.1', '::1', '192.168.1.20', 'app.localhost']) {
    assert(isAllowedHostname(h, []), `${h} allowed by default`);
  }
  assert(!isAllowedHostname('attacker.test', []), 'foreign name blocked');
  assert(!isAllowedHostname('localhost.attacker.test', []), 'localhost prefix is no loophole');
  assert(isAllowedHostname('loomwerk.example.com', ['loomwerk.example.com']), 'exact entry');
  assert(isAllowedHostname('a.example.com', ['.example.com']), 'leading dot covers subdomains');
  assert(isAllowedHostname('example.com', ['.example.com']), 'leading dot covers the name itself');
  assert(!isAllowedHostname('notexample.com', ['.example.com']), 'suffix match is label-aligned');
});

type Reply = { status: number; body: string };
function request(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
  options: { setHost?: boolean } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers, setHost: options.setHost ?? true },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    if (method !== 'GET') req.write('x=1');
    req.end();
  });
}

async function withServer(
  allowedHosts: readonly string[] | undefined,
  fn: (port: number) => Promise<void>,
): Promise<void> {
  const server = createApp(openTestDb(), { allowedHosts }).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  try {
    await fn((server.address() as AddressInfo).port);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

await withServer([], async (port) => {
  const local = `localhost:${port}`;

  await check('GET with Host localhost passes (positive control)', async () => {
    const r = await request(port, 'GET', '/api/health', { host: local });
    assert(r.status === 200, `status ${r.status}`);
  });

  await check('GET with Host 127.0.0.1 passes', async () => {
    const r = await request(port, 'GET', '/api/health', { host: `127.0.0.1:${port}` });
    assert(r.status === 200, `status ${r.status}`);
  });

  await check('DNS rebinding: foreign Host is rejected on GET', async () => {
    const r = await request(port, 'GET', '/api/health', { host: `attacker.test:${port}` });
    assert(r.status === 403, `status ${r.status}`);
    assert(r.body.includes('LOOMWERK_ALLOWED_HOSTS'), 'error names the setting');
  });

  await check('DNS rebinding: foreign Host is rejected on POST', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', {
      host: `attacker.test:${port}`,
      origin: `http://attacker.test:${port}`,
      'sec-fetch-site': 'same-origin',
    });
    assert(r.status === 403, `status ${r.status}`);
  });

  await check('missing Host header is rejected', async () => {
    // Node's own parser may answer 400 first (requireHostHeader); either way
    // the request must not reach the API.
    const r = await request(port, 'GET', '/api/health', {}, { setHost: false });
    assert(r.status === 403 || r.status === 400, `status ${r.status}`);
  });

  await check('CSRF: cross-site form POST is rejected', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', {
      host: local,
      origin: 'http://evil.test',
      'sec-fetch-site': 'cross-site',
      'content-type': 'text/plain',
    });
    assert(r.status === 403, `status ${r.status}`);
  });

  await check('CSRF: Sec-Fetch-Site cross-site alone is enough', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', {
      host: local,
      'sec-fetch-site': 'cross-site',
    });
    assert(r.status === 403, `status ${r.status}`);
  });

  await check('CSRF: foreign Origin alone is enough', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', {
      host: local,
      origin: 'https://evil.test',
    });
    assert(r.status === 403, `status ${r.status}`);
  });

  // The Host check lets IP literals and localhost through without config; the
  // Origin check must not — an attacker can serve a page from either.
  await check('CSRF: page served from an IP address is rejected (no Sec-Fetch-Site)', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', {
      host: local,
      origin: 'http://203.0.113.5',
    });
    assert(r.status === 403, `status ${r.status}`);
  });

  await check('CSRF: page on another localhost port is rejected', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', {
      host: local,
      origin: 'http://localhost:3000',
      'sec-fetch-site': 'same-site',
    });
    assert(r.status === 403, `status ${r.status}`);
  });

  await check('default port: Origin http://localhost matches Host localhost', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', {
      host: 'localhost',
      origin: 'http://localhost',
    });
    assert(r.status === 409, `status ${r.status}`);
  });

  await check('Origin "null" (sandboxed iframe, file://) is rejected', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', { host: local, origin: 'null' });
    assert(r.status === 403, `status ${r.status}`);
  });

  await check('same-origin POST from the bundled UI reaches the handler', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', {
      host: local,
      origin: `http://${local}`,
      'sec-fetch-site': 'same-origin',
    });
    assert(r.status === 409, `status ${r.status} (409 = handler reached, no provider)`);
  });

  await check('Vite dev proxy (localhost:5273) reaches the handler', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', {
      host: 'localhost:5273',
      origin: 'http://localhost:5273',
      'sec-fetch-site': 'same-origin',
    });
    assert(r.status === 409, `status ${r.status}`);
  });

  await check('non-browser client (curl, webhook) without Origin reaches the handler', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', { host: local });
    assert(r.status === 409, `status ${r.status}`);
  });

  await check('GET is not subject to the Origin check', async () => {
    const r = await request(port, 'GET', '/api/health', { host: local, origin: 'http://evil.test' });
    assert(r.status === 200, `status ${r.status}`);
  });
});

await withServer(['loomwerk.example.com'], async (port) => {
  await check('configured host passes GET and same-origin POST', async () => {
    const host = 'loomwerk.example.com';
    const g = await request(port, 'GET', '/api/health', { host });
    assert(g.status === 200, `GET status ${g.status}`);
    const p = await request(port, 'POST', '/api/engine/cycle', {
      host,
      origin: `https://${host}`,
      'sec-fetch-site': 'same-origin',
    });
    assert(p.status === 409, `POST status ${p.status}`);
  });

  await check('reverse proxy rewrites Host: the listed public Origin passes', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', {
      host: `127.0.0.1:${port}`,
      origin: 'https://loomwerk.example.com',
      'sec-fetch-site': 'same-origin',
    });
    assert(r.status === 409, `status ${r.status}`);
  });

  await check('a configured list does not make IP origins trusted', async () => {
    const r = await request(port, 'POST', '/api/engine/cycle', {
      host: `127.0.0.1:${port}`,
      origin: 'http://203.0.113.5',
    });
    assert(r.status === 403, `status ${r.status}`);
  });

  await check('configured host does not open other names', async () => {
    const r = await request(port, 'GET', '/api/health', { host: 'attacker.test' });
    assert(r.status === 403, `status ${r.status}`);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
