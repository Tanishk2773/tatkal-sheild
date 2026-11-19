import { lookups } from './rail-lookups.js';

const form = document.querySelector('#lookup');
const method = document.querySelector('#lookup-method');
const fields = document.querySelector('#lookup-fields');
const status = document.querySelector('#lookup-status');
const results = document.querySelector('#lookup-results');
const submit = form.querySelector('button');

method.append(...lookups.map(([id, label]) => new Option(label, id)));
function showFields() {
  fields.replaceChildren();
  for (const { name, label, pattern } of lookups.find(([id]) => id === method.value).slice(2)) {
    const container = document.createElement('label');
    const input = document.createElement('input');
    Object.assign(input, { name, pattern, required: true, autocomplete: 'off' });
    if (name === 'name') input.pattern = "[A-Za-z0-9 .'\\-]{2,60}";
    container.append(label, input);
    fields.append(container);
  }
}
method.addEventListener('change', () => {
  showFields();
  results.replaceChildren();
});
showFields();

function readable(key) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
}
function render(value) {
  if (!value || typeof value !== 'object') return document.createTextNode(String(value ?? '—'));
  const list = document.createElement('dl');
  for (const [key, data] of Object.entries(value).slice(0, 50)) {
    const row = document.createElement('div');
    const label = document.createElement('dt');
    const detail = document.createElement('dd');
    label.textContent = Array.isArray(value) ? 'Result ' + (Number(key) + 1) : readable(key);
    if (data && typeof data === 'object') {
      const expandable = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = data.train_name || data.station_name || 'View details';
      expandable.append(summary, render(data));
      detail.append(expandable);
    } else detail.append(render(data));
    row.append(label, detail);
    list.append(row);
  }
  return list;
}
try {
  const response = await fetch('/api/railkit/status');
  const { enabled } = await response.json();
  submit.disabled = !enabled;
  if (!enabled) status.textContent = 'Live lookups are currently unavailable. Demo train booking is available.';
} catch {
  status.textContent = 'Rail information service is unavailable.';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  submit.disabled = method.disabled = true;
  status.textContent = 'Checking RailKit…';
  results.replaceChildren();
  try {
    const response = await fetch('/api/railkit/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: method.value, fields: Object.fromEntries(new FormData(form)) }),
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const found = data.result && Object.keys(data.result).length;
    status.textContent = found ? 'Results from RailKit' : 'No results returned.';
    if (found) results.append(render(data.result));
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = method.disabled = false;
  }
});
