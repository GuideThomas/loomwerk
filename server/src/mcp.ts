// MCP stdio entry — `loomwerk-mcp` (or `npm run mcp -w server` in the repo).
//
// stdout belongs to the protocol here: nothing in this process may write to
// it except the transport. Engine diagnostics go to stderr, which MCP
// clients surface as logs.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getDb } from './db.js';
import { buildMcpServer } from './mcp/server.js';

const db = getDb();
const server = buildMcpServer(db, '0.3.0');
await server.connect(new StdioServerTransport());
console.error('[loomwerk-mcp] ready (stdio)');
