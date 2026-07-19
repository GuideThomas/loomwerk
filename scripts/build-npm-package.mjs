// Assemble the publishable npm package into build/npm.
//
// The repo is a private monorepo; what ships to npm is the assembled app:
// compiled server, migrations, built client, and a bin so `npx loomwerk`
// starts a running instance. Layout preserves the relative paths the server
// resolves at runtime (migrations, client dist).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'build', 'npm');

const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const serverPkg = JSON.parse(fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'));

for (const dir of ['server/dist', 'client/dist']) {
  if (!fs.existsSync(path.join(root, dir))) {
    console.error(`missing ${dir} — run \`npm run build\` first`);
    process.exit(1);
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'bin'), { recursive: true });

fs.cpSync(path.join(root, 'server', 'dist'), path.join(out, 'server', 'dist'), { recursive: true });
fs.cpSync(path.join(root, 'server', 'migrations'), path.join(out, 'server', 'migrations'), { recursive: true });
fs.cpSync(path.join(root, 'client', 'dist'), path.join(out, 'client', 'dist'), { recursive: true });
for (const f of ['README.md', 'LICENSE', 'NOTICE']) {
  fs.copyFileSync(path.join(root, f), path.join(out, f));
}

fs.writeFileSync(
  path.join(out, 'bin', 'loomwerk.js'),
  `#!/usr/bin/env node
import('../server/dist/index.js');
`,
);

const pkg = {
  name: 'loomwerk',
  version: rootPkg.version,
  description: rootPkg.description,
  author: rootPkg.author,
  license: rootPkg.license,
  type: 'module',
  bin: { loomwerk: 'bin/loomwerk.js' },
  repository: { type: 'git', url: 'git+https://github.com/GuideThomas/loomwerk.git' },
  homepage: 'https://github.com/GuideThomas/loomwerk#readme',
  bugs: 'https://github.com/GuideThomas/loomwerk/issues',
  keywords: [
    'innovation-engine', 'quality-diversity', 'map-elites', 'novelty-search',
    'knowledge-management', 'llm', 'obsidian', 'idea-generation',
  ],
  engines: rootPkg.engines,
  dependencies: {
    'better-sqlite3': serverPkg.dependencies['better-sqlite3'],
    express: serverPkg.dependencies.express,
    ...(serverPkg.dependencies['@modelcontextprotocol/sdk']
      ? {
          '@modelcontextprotocol/sdk': serverPkg.dependencies['@modelcontextprotocol/sdk'],
          zod: serverPkg.dependencies.zod,
        }
      : {}),
  },
};
if (fs.existsSync(path.join(out, 'server', 'dist', 'mcp.js'))) {
  pkg.bin['loomwerk-mcp'] = 'bin/loomwerk-mcp.js';
  fs.writeFileSync(
    path.join(out, 'bin', 'loomwerk-mcp.js'),
    `#!/usr/bin/env node
import('../server/dist/mcp.js');
`,
  );
}
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

console.log(`assembled ${out} (version ${pkg.version}, bins: ${Object.keys(pkg.bin).join(', ')})`);
