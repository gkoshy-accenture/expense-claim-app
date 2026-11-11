'use strict';

// All URLs are relative (no leading slash) so the app works under /myapp/.
const form = document.getElementById('claim-form');
const errorsEl = document.getElementById('errors');
const tableEl = document.getElementById('claims');
const emptyEl = document.getElementById('empty');
const categoryEl = document.getElementById('category');

const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

async function loadConfig() {
  try {
    const res = await fetch('config.json', { cache: 'no-store' });
    const cfg = await res.json();
    document.getElementById('workshopper').textContent = cfg.workshopper || 'unknown';
    document.getElementById('tagline').textContent = cfg.tagline || '';
  } catch (e) {
    document.getElementById('workshopper').textContent = 'unknown';
  }
}

async function loadCategories() {
  const res = await fetch('api/categories');
  const items = await res.json();
  categoryEl.innerHTML = '<option value="">Choose...</option>' +
    items.map((c) => '<option>' + c + '</option>').join('');
}

function renderClaims(claims) {
  const body = tableEl.querySelector('tbody');
  body.textContent = '';
  claims.forEach((c) => {
    const tr = document.createElement('tr');
    [c.id, c.employee, c.category].forEach((v) => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    const amount = document.createElement('td');
    amount.className = 'num';
    amount.textContent = money.format(c.amount);
    tr.appendChild(amount);
    const status = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'status';
    badge.textContent = c.status;
    status.appendChild(badge);
    tr.appendChild(status);
    body.appendChild(tr);
  });
  tableEl.hidden = claims.length === 0;
  emptyEl.hidden = claims.length !== 0;
}

async function loadClaims() {
  try {
    const res = await fetch('api/claims');
    const data = await res.json();
    if (!res.ok) { showErrors(data.errors || ['Could not load claims.']); return; }
    renderClaims(data);
  } catch (e) {
    showErrors(['Could not reach the server. Check your connection and refresh.']);
  }
}

function showErrors(list) {
  errorsEl.textContent = '';
  list.forEach((msg) => {
    const li = document.createElement('li');
    li.textContent = msg;
    errorsEl.appendChild(li);
  });
  errorsEl.hidden = list.length === 0;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showErrors([]);
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const res = await fetch('api/claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const data = await res.json();
    if (!res.ok) { showErrors(data.errors || ['The claim was not saved. Try again.']); return; }
    form.reset();
    await loadClaims();
  } catch (e) {
    showErrors(['Could not reach the server. Check your connection and try again.']);
  } finally {
    button.disabled = false;
  }
});

loadConfig();
loadCategories();
loadClaims();
