'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { validateClaim, createStore, CATEGORIES } = require('../lib/claims');

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

test('store lists newest claims first', () => {
  const store = createStore();
  store.add({ employee: 'A' });
  store.add({ employee: 'B' });
  assert.deepStrictEqual(store.list().map((c) => c.employee), ['B', 'A']);
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
