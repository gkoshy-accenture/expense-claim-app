'use strict';

const CATEGORIES = ['Travel', 'Meals', 'Software', 'Equipment', 'Other'];
const MAX_AMOUNT = 10000;

/**
 * Validate a claim submitted from the form.
 * Returns { ok: true, claim } or { ok: false, errors: [...] }.
 */
function validateClaim(input) {
  const errors = [];
  const data = input && typeof input === 'object' ? input : {};

  const employee = String(data.employee || '').trim();
  const category = String(data.category || '').trim();
  const description = String(data.description || '').trim();
  const amount = Number(data.amount);

  if (employee.length < 2) errors.push('Enter the employee name (at least 2 characters).');
  if (!CATEGORIES.includes(category)) errors.push('Choose a category from the list.');
  if (!Number.isFinite(amount) || amount <= 0) errors.push('Enter an amount greater than 0.');
  if (amount > MAX_AMOUNT) errors.push('Amounts above ' + MAX_AMOUNT + ' need manager approval.');
  if (description.length < 3) errors.push('Add a short description of the expense.');

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    claim: {
      employee: employee.slice(0, 80),
      category,
      amount: Math.round(amount * 100) / 100,
      description: description.slice(0, 200)
    }
  };
}

/**
 * Build the SQL Server connection settings from environment variables.
 * Returns null when DB_SERVER is not set (the app then falls back to a local SQLite file).
 */
function mssqlConfigFromEnv(env) {
  if (!env.DB_SERVER) return null;
  const missing = ['DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter((k) => !env[k]);
  if (missing.length) throw new Error('DB_SERVER is set but these settings are missing: ' + missing.join(', '));
  return {
    server: env.DB_SERVER,
    port: Number(env.DB_PORT || 1433),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: { encrypt: env.DB_ENCRYPT !== 'false', trustServerCertificate: false },
    // A serverless Azure SQL database can take about a minute to wake up from a pause.
    connectionTimeout: 60000,
    requestTimeout: 30000,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 }
  };
}

/**
 * SQLite-backed store using Node's built-in node:sqlite (Node 22.13 or newer).
 * Pass ':memory:' for tests, or a file path to keep data between restarts.
 * All methods are async so they match the SQL Server store.
 */
function createStore(dbPath) {
  const fs = require('fs');
  const path = require('path');
  const { DatabaseSync } = require('node:sqlite');

  const file = dbPath || ':memory:';
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  // Only ever CREATE ... IF NOT EXISTS here, so a bad branch cannot drop existing data.
  db.exec(`CREATE TABLE IF NOT EXISTS claims (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee    TEXT NOT NULL,
    category    TEXT NOT NULL,
    amount      REAL NOT NULL,
    description TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'Submitted',
    created_at  TEXT NOT NULL
  )`);

  const insert = db.prepare(
    'INSERT INTO claims (employee, category, amount, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const selectAll = db.prepare(
    'SELECT id, employee, category, amount, description, status, created_at FROM claims ORDER BY id DESC'
  );
  const toClaim = (row) => ({
    id: row.id, employee: row.employee, category: row.category, amount: row.amount,
    description: row.description, status: row.status, createdAt: row.created_at
  });

  return {
    kind: 'sqlite',
    async list() { return selectAll.all().map(toClaim); },
    async add(claim) {
      const createdAt = new Date().toISOString();
      const status = claim.status || 'Submitted';
      const info = insert.run(claim.employee, claim.category, claim.amount, claim.description, status, createdAt);
      return Object.assign({}, claim, { id: Number(info.lastInsertRowid), status, createdAt });
    },
    async reset() { db.exec('DELETE FROM claims'); },
    async ping() { db.prepare('SELECT 1').get(); return true; },
    async close() { db.close(); }
  };
}

/**
 * Azure SQL / SQL Server store using the "mssql" package (loaded only when needed).
 * The table is created once by deploy/azure-sql-setup.sql; the app login has no rights to change the schema.
 */
function createMssqlStore(config) {
  const sql = require('mssql');
  let poolPromise = null;

  function getPool() {
    if (!poolPromise) {
      poolPromise = new sql.ConnectionPool(config).connect().catch((err) => {
        poolPromise = null; // allow a retry on the next request
        throw err;
      });
    }
    return poolPromise;
  }

  const toClaim = (row) => ({
    id: row.id, employee: row.employee, category: row.category, amount: Number(row.amount),
    description: row.description, status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  });

  return {
    kind: 'mssql',
    async list() {
      const pool = await getPool();
      const result = await pool.request().query(
        'SELECT id, employee, category, amount, description, status, created_at FROM dbo.claims ORDER BY id DESC'
      );
      return result.recordset.map(toClaim);
    },
    async add(claim) {
      const pool = await getPool();
      const status = claim.status || 'Submitted';
      const result = await pool.request()
        .input('employee', sql.NVarChar(80), claim.employee)
        .input('category', sql.NVarChar(30), claim.category)
        .input('amount', sql.Decimal(10, 2), claim.amount)
        .input('description', sql.NVarChar(200), claim.description)
        .input('status', sql.NVarChar(20), status)
        .query(`INSERT INTO dbo.claims (employee, category, amount, description, status)
                OUTPUT INSERTED.id, INSERTED.created_at
                VALUES (@employee, @category, @amount, @description, @status)`);
      const row = result.recordset[0];
      return Object.assign({}, claim, {
        id: row.id, status,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      });
    },
    async reset() {
      const pool = await getPool();
      await pool.request().query('DELETE FROM dbo.claims');
    },
    async ping() {
      const pool = await getPool();
      await pool.request().query('SELECT 1 AS ok');
      return true;
    },
    async close() {
      if (poolPromise) { const pool = await poolPromise.catch(() => null); if (pool) await pool.close(); }
    }
  };
}

/** Azure SQL when DB_SERVER is set, otherwise a local SQLite file. */
function storeFromEnv(env, defaultSqlitePath) {
  const cfg = mssqlConfigFromEnv(env);
  return cfg ? createMssqlStore(cfg) : createStore(env.DB_PATH || defaultSqlitePath);
}

module.exports = { CATEGORIES, MAX_AMOUNT, validateClaim, createStore, createMssqlStore, mssqlConfigFromEnv, storeFromEnv };
