// Shared helpers for till + admin
const money = (p) => '£' + (Number(p || 0) / 100).toFixed(2);
const payLabel = (m) => ({ card: 'card', cash: 'cash', fresha: 'Fresha' })[m] || m;
const toPence = (v) => Math.round(parseFloat(String(v).replace(/[£,\s]/g, '')) * 100);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);

function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
  } catch (e) { return null; }
}

function makeApi(tokenKey, onUnauthorised) {
  return async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const t = store(tokenKey);
    if (t) headers.Authorization = 'Bearer ' + t;
    const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    if (res.status === 401 && onUnauthorised) { onUnauthorised(); throw new Error('Not logged in'); }
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  };
}

let toastTimer;
function toast(msg, isErr) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
