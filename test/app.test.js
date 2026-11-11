'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { validateClaim, createStore, mssqlConfigFromEnv, storeFromEnv, CATEGORIES } = require('../lib/claims');

test('accepts a valid claim and rounds the amount', () => {
  const r = validateClaim({ employee: 'Asha', category: 'Travel', amount: '12.345', description: 'Train ticket' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.claim.amount, 12.35);
});

test('rejects missing fields with clear messages', () => {
  const r = validateClaim({});
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.length >= 4);
});

test('rejects unknown categories', () => {
  const r = validateClaim({ employee: 'Asha', category: 'Yachts', amount: 5, description: 'Nope' });
  assert.strictEqual(r.ok, false);
});

test('rejects amounts above the approval limit', () => {
  const r = validateClaim({ employee: 'Asha', category: CATEGORIES[0], amount: 99999, description: 'Big one' });
  assert.strictEqual(r.ok, false);
});

test('store lists newest claims first', async () => {
  const store = createStore(':memory:');
  const base = { category: 'Travel', amount: 1, description: 'Test claim' };
  await store.add(Object.assign({ employee: 'A' }, base));
  await store.add(Object.assign({ employee: 'B' }, base));
  assert.deepStrictEqual((await store.list()).map((c) => c.employee), ['B', 'A']);
});

test('public/config.json is valid and has a name', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'config.json'), 'utf8'));
  assert.ok(typeof cfg.workshopper === 'string' && cfg.workshopper.trim().length > 0);
});

test('front end uses relative URLs only', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(!/fetch\(\s*['"]\//.test(js), 'fetch() must not start with a slash');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(!/(src|href)="\//.test(html), 'src/href must not start with a slash');
});

test('claims persist in the database file between store instances', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-'));
  const file = path.join(dir, 'claims.db');
  const first = createStore(file);
  await first.add({ employee: 'Asha', category: 'Travel', amount: 10, description: 'Bus' });
  await first.close();
  const second = createStore(file);
  const rows = await second.list();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].employee, 'Asha');
  await second.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('no DB_SERVER means no SQL Server config (SQLite fallback)', () => {
  assert.strictEqual(mssqlConfigFromEnv({}), null);
  const store = storeFromEnv({ DB_PATH: ':memory:' }, ':memory:');
  assert.strictEqual(store.kind, 'sqlite');
});

test('SQL Server config is built from environment variables', () => {
  const cfg = mssqlConfigFromEnv({ DB_SERVER: 'x.database.windows.net', DB_NAME: 'db', DB_USER: 'u', DB_PASSWORD: 'p' });
  assert.strictEqual(cfg.server, 'x.database.windows.net');
  assert.strictEqual(cfg.port, 1433);
  assert.strictEqual(cfg.options.encrypt, true);
  assert.strictEqual(cfg.options.trustServerCertificate, false);
});

test('incomplete SQL Server settings fail loudly, naming the missing keys', () => {
  assert.throws(() => mssqlConfigFromEnv({ DB_SERVER: 'x', DB_NAME: 'db' }), /DB_USER, DB_PASSWORD/);
});
