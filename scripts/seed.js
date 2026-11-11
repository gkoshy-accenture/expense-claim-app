'use strict';

// Host-only helper: clears the claims table and loads a few sample claims.
// Uses Azure SQL when DB_SERVER and friends are set (for example: set -a; . /etc/demo-app.env; set +a),
// otherwise a local SQLite file.
const path = require('path');
const { storeFromEnv } = require('../lib/claims');

const store = storeFromEnv(process.env, path.join(__dirname, '..', 'data', 'claims.db'));

(async () => {
  await store.reset();
  const samples = [
    { employee: 'Maya Chen', category: 'Travel', amount: 184.2, description: 'Train to client workshop', status: 'Approved' },
    { employee: 'Tom Becker', category: 'Software', amount: 49.0, description: 'Monthly design tool licence', status: 'Submitted' },
    { employee: 'Priya Nair', category: 'Meals', amount: 36.75, description: 'Team lunch during sprint review', status: 'Submitted' }
  ];
  for (const c of samples) await store.add(c);
  console.log('Seeded ' + (await store.list()).length + ' claims (' + store.kind + ')');
  await store.close();
})().catch((e) => { console.error('Seeding failed:', e.message); process.exit(1); });
