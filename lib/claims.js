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

/** In-memory store. Restarting the app clears it, which is fine for a demo. */
function createStore() {
  const claims = [];
  let nextId = 1;
  return {
    list() {
      return claims.slice().reverse();
    },
    add(claim) {
      const saved = Object.assign({ id: nextId++, status: 'Submitted', createdAt: new Date().toISOString() }, claim);
      claims.push(saved);
      return saved;
    }
  };
}

module.exports = { CATEGORIES, MAX_AMOUNT, validateClaim, createStore };
