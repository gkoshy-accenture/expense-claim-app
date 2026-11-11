'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { CATEGORIES, validateClaim, storeFromEnv } = require('./lib/claims');

const HOST = process.env.HOST || '127.0.0.1'; // keep local; Caddy exposes it over HTTPS
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const store = storeFromEnv(process.env, path.join(__dirname, 'data', 'claims.db'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 10 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const route = req.url.split('?')[0];
  try {
    if (route === '/health') return sendJson(res, 200, { status: 'ok', database: store.kind });
    if (route === '/health/db') {
      try { await store.ping(); return sendJson(res, 200, { status: 'ok', database: store.kind }); }
      catch (e) { console.error('Database check failed:', e.message); return sendJson(res, 503, { status: 'error', database: store.kind }); }
    }
    if (route === '/api/categories' && req.method === 'GET') return sendJson(res, 200, CATEGORIES);
    if (route === '/api/claims' && req.method === 'GET') return sendJson(res, 200, await store.list());
    if (route === '/api/claims' && req.method === 'POST') {
      let payload;
      try { payload = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, { errors: ['Send the claim as valid JSON.'] }); }
      const result = validateClaim(payload);
      if (!result.ok) return sendJson(res, 422, { errors: result.errors });
      return sendJson(res, 201, await store.add(result.claim));
    }
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405); res.end('Method not allowed');
  } catch (e) {
    console.error('Request failed:', e.message); // details stay in the server log, not in the response
    sendJson(res, 503, { errors: ['The database did not respond. If it was idle it may be waking up, so try again in about a minute.'] });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log('Expense claim app listening on http://' + HOST + ':' + PORT + ' (database: ' + store.kind + ')'));
}

module.exports = server;
