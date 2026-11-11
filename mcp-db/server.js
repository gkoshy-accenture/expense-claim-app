'use strict';

// Minimal read-only MCP server for the expense claims database.
// Transport: MCP "Streamable HTTP" (JSON-RPC over POST, plain JSON responses).
// Auth: static bearer token from MCP_TOKEN.
// Data: Azure SQL when DB_SERVER is set (log in as a user that only has db_datareader),
//       otherwise a SQLite file opened read-only (DB_PATH).
//
//   MCP_TOKEN=... DB_SERVER=... DB_NAME=... DB_USER=mcp_reader DB_PASSWORD=... node mcp-db/server.js

const http = require('http');
const crypto = require('crypto');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3100);
const DB_PATH = process.env.DB_PATH || '/var/lib/demo-app/claims.db';
const TOKEN = process.env.MCP_TOKEN || '';
const MAX_ROWS = 100;
const PROTOCOL_VERSION = '2025-03-26';

if (TOKEN.length < 16) {
  console.error('MCP_TOKEN must be set and at least 16 characters long.');
  process.exit(1);
}

// ---- Database backends -------------------------------------------------------------------------
// Both backends expose: schema(), listClaims({status, category, limit}), runQuery(sql).
// Writes are blocked by the database itself: SQLite is opened read-only, and the SQL Server login
// (mcp_reader) only has the db_datareader role.

function sqliteBackend() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const plain = (rows) => rows.map((r) => Object.assign({}, r));
  return {
    kind: 'sqlite',
    async schema() {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      return tables.map((t) => ({
        table: t.name,
        columns: plain(db.prepare('PRAGMA table_info(' + JSON.stringify(t.name) + ')').all())
          .map((c) => ({ name: c.name, type: c.type, notNull: !!c.notnull, primaryKey: !!c.pk }))
      }));
    },
    async listClaims({ status, category, limit }) {
      const where = [];
      const params = [];
      if (status) { where.push('status = ?'); params.push(status); }
      if (category) { where.push('category = ?'); params.push(category); }
      const sql = 'SELECT id, employee, category, amount, description, status, created_at FROM claims' +
        (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC LIMIT ' + limit;
      return plain(db.prepare(sql).all(...params));
    },
    async runQuery(sqlText) {
      return plain(db.prepare(sqlText).all());
    }
  };
}

function mssqlBackend() {
  const missing = ['DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter((k) => !process.env[k]);
  if (missing.length) throw new Error('DB_SERVER is set but these settings are missing: ' + missing.join(', '));
  const sql = require('mssql'); // installed by "npm install" in /opt/mcp-db
  const config = {
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT || 1433),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: process.env.DB_ENCRYPT !== 'false', trustServerCertificate: false },
    connectionTimeout: 60000, // a paused serverless database can take about a minute to wake up
    requestTimeout: 30000,
    pool: { max: 3, min: 0, idleTimeoutMillis: 30000 }
  };
  let poolPromise = null;
  const getPool = () => {
    if (!poolPromise) {
      poolPromise = new sql.ConnectionPool(config).connect().catch((e) => { poolPromise = null; throw e; });
    }
    return poolPromise;
  };
  return {
    kind: 'mssql',
    async schema() {
      const pool = await getPool();
      const r = await pool.request().query(
        'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_NAME, ORDINAL_POSITION'
      );
      const tables = {};
      r.recordset.forEach((c) => {
        (tables[c.TABLE_NAME] = tables[c.TABLE_NAME] || []).push({ name: c.COLUMN_NAME, type: c.DATA_TYPE, notNull: c.IS_NULLABLE === 'NO' });
      });
      return Object.keys(tables).map((t) => ({ table: t, columns: tables[t] }));
    },
    async listClaims({ status, category, limit }) {
      const pool = await getPool();
      const req = pool.request();
      const where = [];
      if (status) { req.input('status', sql.NVarChar(20), status); where.push('status = @status'); }
      if (category) { req.input('category', sql.NVarChar(30), category); where.push('category = @category'); }
      const q = 'SELECT TOP (' + limit + ') id, employee, category, amount, description, status, created_at FROM dbo.claims' +
        (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC';
      return (await req.query(q)).recordset;
    },
    async runQuery(sqlText) {
      const pool = await getPool();
      // SET ROWCOUNT caps the rows SQL Server returns, so a huge table cannot flood the response.
      const r = await pool.request().query('SET ROWCOUNT ' + (MAX_ROWS + 1) + '; ' + sqlText);
      return r.recordset || [];
    }
  };
}

const backend = process.env.DB_SERVER ? mssqlBackend() : sqliteBackend();

// ---- MCP tools ---------------------------------------------------------------------------------
const TOOLS = [
  {
    name: 'describe_schema',
    description: 'Show the tables and columns in the expense claims database.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'list_claims',
    description: 'List expense claims, newest first. Optionally filter by status or category.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'For example Submitted or Approved' },
        category: { type: 'string', description: 'Travel, Meals, Software, Equipment or Other' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Default 20' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'run_query',
    description: 'Run one read-only SQL SELECT against the claims database. Returns at most ' + MAX_ROWS + ' rows.',
    inputSchema: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'A single SELECT statement, for example: SELECT category, SUM(amount) FROM claims GROUP BY category' } },
      required: ['sql'],
      additionalProperties: false
    }
  }
];

function text(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}
function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

async function callTool(name, args) {
  args = args || {};
  if (name === 'describe_schema') {
    return text(await backend.schema());
  }

  if (name === 'list_claims') {
    const limit = Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), MAX_ROWS);
    const rows = await backend.listClaims({
      status: args.status ? String(args.status) : '',
      category: args.category ? String(args.category) : '',
      limit
    });
    return text(rows);
  }

  if (name === 'run_query') {
    const sql = String(args.sql || '').trim().replace(/;+\s*$/, '');
    if (!/^(select|with)\b/i.test(sql)) return toolError('Only SELECT statements are allowed.');
    if (sql.includes(';')) return toolError('Send one statement only (no semicolons inside the query).');
    try {
      const rows = await backend.runQuery(sql);
      const truncated = rows.length > MAX_ROWS;
      return text({ rowCount: Math.min(rows.length, MAX_ROWS), truncated, rows: rows.slice(0, MAX_ROWS) });
    } catch (e) {
      return toolError('Query failed: ' + e.message);
    }
  }

  return toolError('Unknown tool: ' + name);
}

async function handleRpc(msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;
  if (isNotification) return null; // notifications (e.g. notifications/initialized) get no body

  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'expense-claims-db', version: '1.1.0' }
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call':
      if (!params || typeof params.name !== 'string') return fail(-32602, 'Missing tool name');
      try { return ok(await callTool(params.name, params.arguments)); }
      catch (e) {
        console.error('Tool failed:', e.message); // details stay in the server log
        return ok(toolError('The database did not respond. If it was idle it may be waking up, so try again in about a minute.'));
      }
    default:
      return fail(-32601, 'Method not found: ' + method);
  }
}

// ---- HTTP ---------------------------------------------------------------------------------------
function authorized(req) {
  const header = req.headers['authorization'] || '';
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function send(res, status, body, extra) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  res.writeHead(status, headers);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const route = req.url.split('?')[0];
  if (route !== '/' && route !== '/mcp') return send(res, 404, { error: 'Not found' });
  if (!authorized(req)) return send(res, 401, { error: 'Missing or invalid bearer token' }, { 'WWW-Authenticate': 'Bearer' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' }, { Allow: 'POST' });

  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > 64 * 1024) { send(res, 413, { error: 'Request too large' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (res.writableEnded) return;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch (e) { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }

    const batch = Array.isArray(body);
    const replies = (await Promise.all((batch ? body : [body]).map(handleRpc))).filter(Boolean);
    if (replies.length === 0) return send(res, 202); // only notifications
    send(res, 200, batch ? replies : replies[0]);
  });
});

server.listen(PORT, HOST, () => console.log('Claims DB MCP server on http://' + HOST + ':' + PORT + ' (read-only, backend: ' + backend.kind + ')'));
