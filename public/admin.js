const api = makeApi('admin_token', () => { store('admin_token', null); showLogin(); });
const state = { shops: [], date: null, today: null, tab: 'day', barbers: [], services: [] };

function showLogin() { $('#view-login').classList.remove('hidden'); $('#view-app').classList.add('hidden'); }

$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('#login-err').textContent = '';
  try {
    const { token } = await api('/api/admin/login', { method: 'POST', body: { password: $('#login-pw').value } });
    store('admin_token', token);
    $('#login-pw').value = '';
    boot();
  } catch (e) { $('#login-err').textContent = e.message; }
});

$('#btn-logout').addEventListener('click', () => { store('admin_token', null); showLogin(); });

async function boot() {
  if (!store('admin_token')) return showLogin();
  try { state.shops = await api('/api/shops'); } catch (e) { return; }
  $('#view-login').classList.add('hidden');
  $('#view-app').classList.remove('hidden');
  fillShopSelects();
  await loadDay();
}

function fillShopSelects() {
  const opts = state.shops.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const keep = (sel, html) => { const v = $(sel).value; $(sel).innerHTML = html; if (v) $(sel).value = v; };
  keep('#day-shop', `<option value="all">All shops</option>${opts}`);
  keep('#nb-shop', opts);
  keep('#svc-shop', opts);
}

// ---------- tabs ----------
document.querySelector('.tabs').addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-tab]');
  if (t) openTab(t.dataset.tab);
});

function openTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab));
  ({ day: loadDay, history: loadHistory, barbers: loadBarbers, services: loadServices, settings: loadSettings })[tab]();
}

// ---------- day ----------
function shiftDate(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadDay(date) {
  if (date) state.date = date;
  const shopId = $('#day-shop').value || 'all';
  const q = new URLSearchParams({ shopId });
  if (state.date) q.set('date', state.date);
  const data = await api('/api/admin/day?' + q);
  state.date = data.date;
  state.today = data.today;
  state.day = data;
  $('#day-date').value = data.date;
  $('#day-date').max = data.today;
  $('#day-next').disabled = data.date >= data.today;
  const shopName = shopId === 'all' ? 'All shops' : state.shops.find((s) => String(s.id) === shopId)?.name;
  $('#day-title').textContent = `${prettyDate(data.date)} · ${shopName}`;
  $('#day-live').textContent = data.date === data.today ? 'Live – updates every 30 seconds' : '';

  const t = data.summary.totals;
  $('#day-stats').innerHTML = `
    <div class="stat hero"><div class="label">Total taken</div><div class="value">${money(t.total)}</div></div>
    <div class="stat"><div class="label">Cuts</div><div class="value">${t.cuts}</div></div>
    <div class="stat"><div class="label">Haircut takings</div><div class="value">${money(t.takings)}</div></div>
    <div class="stat"><div class="label">Card</div><div class="value">${money(t.card)}</div></div>
    <div class="stat"><div class="label">Cash</div><div class="value">${money(t.cash)}</div></div>
    <div class="stat"><div class="label">Fresha</div><div class="value">${money(t.fresha)}</div></div>
    <div class="stat"><div class="label">Tips</div><div class="value">${money(t.tips)}</div></div>
    <div class="stat"><div class="label">Wax (${t.wax_qty})</div><div class="value">${money(t.wax)}</div></div>`;

  $('#day-shops-wrap').classList.toggle('hidden', shopId !== 'all');
  const shopRow = (s) => `<tr><td>${esc(s.name)}</td><td class="r">${s.cuts}</td><td class="r">${money(s.takings)}</td><td class="r">${money(s.tips)}</td><td class="r">${money(s.wax)}</td><td class="r">${money(s.card)}</td><td class="r">${money(s.cash)}</td><td class="r">${money(s.fresha)}</td><td class="r"><b>${money(s.total)}</b></td></tr>`;
  $('#day-shops').innerHTML = data.summary.shops.map(shopRow).join('') || '<tr><td colspan="9" class="muted">No cuts logged.</td></tr>';

  $('#day-barbers').innerHTML = data.summary.barbers.map((b) => `<tr><td>${esc(b.name)}</td><td class="r">${b.cuts}</td><td class="r">${money(b.takings)}</td><td class="r">${money(b.tips)}</td><td class="r">${money(b.wax)}</td><td class="r">${money(b.card)}</td><td class="r">${money(b.cash)}</td><td class="r">${money(b.fresha)}</td><td class="r"><b>${money(b.total)}</b></td><td class="r">${money(b.commission)}</td></tr>`).join('')
    || '<tr><td colspan="10" class="muted">No cuts logged.</td></tr>';

  $('#day-log').innerHTML = data.entries.map((e) => `
    <tr class="${e.voided ? 'voided' : ''}">
      <td class="num">${e.time}</td><td>${esc(e.shop_name)}</td><td>${esc(e.barber_name)}</td><td>${esc(e.service_name)}</td>
      <td class="r">${money(e.price_pence)}</td><td class="r">${e.tip_pence ? money(e.tip_pence) : '–'}</td>
      <td class="r">${e.wax_qty ? e.wax_qty + ' · ' + money(e.wax_pence) : '–'}</td>
      <td class="r"><b>${money(e.price_pence + e.tip_pence + e.wax_pence)}</b></td>
      <td class="keep"><span class="tag ${e.payment_method}">${payLabel(e.payment_method)}</span>${e.voided ? ' <span class="tag void">voided</span>' : ''}</td>
      <td class="keep r no-print"><button class="btn small" data-void="${e.id}">${e.voided ? 'Restore' : 'Void'}</button></td>
    </tr>`).join('') || '<tr><td colspan="10" class="muted">No cuts logged.</td></tr>';
}

$('#day-date').addEventListener('change', () => $('#day-date').value && loadDay($('#day-date').value));
$('#day-prev').addEventListener('click', () => loadDay(shiftDate(state.date, -1)));
$('#day-next').addEventListener('click', () => loadDay(shiftDate(state.date, 1)));
$('#day-today').addEventListener('click', () => loadDay(state.today));
$('#day-shop').addEventListener('change', () => loadDay());

$('#day-log').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-void]');
  if (!b) return;
  try { const r = await api(`/api/till/entries/${b.dataset.void}/void`, { method: 'POST' }); toast(r.voided ? 'Entry voided' : 'Entry restored'); } catch (e) { toast(e.message, true); }
  loadDay();
});

$('#day-csv').addEventListener('click', async () => {
  const q = new URLSearchParams({ shopId: $('#day-shop').value || 'all', date: state.date });
  const res = await fetch('/api/admin/day.csv?' + q, { headers: { Authorization: 'Bearer ' + store('admin_token') } });
  if (!res.ok) return toast('Could not download', true);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: `till-${state.date}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

setInterval(() => {
  if (state.tab === 'day' && state.date && state.date === state.today && !$('#view-app').classList.contains('hidden')) loadDay().catch(() => {});
}, 30000);

// ---------- history ----------
async function loadHistory() {
  const rows = await api('/api/admin/history?days=' + $('#hist-range').value);
  const days = new Map();
  for (const r of rows) {
    if (!days.has(r.date)) days.set(r.date, { date: r.date, shops: {}, total: 0, cuts: 0, card: 0, cash: 0, fresha: 0, tips: 0, wax: 0 });
    const d = days.get(r.date);
    d.shops[r.shop_id] = r;
    for (const k of ['total', 'cuts', 'card', 'cash', 'fresha', 'tips', 'wax']) d[k] += r[k];
  }
  const sum = (k) => [...days.values()].reduce((a, d) => a + d[k], 0);
  const n = days.size;
  $('#hist-stats').innerHTML = `
    <div class="stat hero"><div class="label">Total in period</div><div class="value">${money(sum('total'))}</div></div>
    <div class="stat"><div class="label">Cuts</div><div class="value">${sum('cuts')}</div></div>
    <div class="stat"><div class="label">Avg per trading day</div><div class="value">${money(n ? sum('total') / n : 0)}</div></div>
    <div class="stat"><div class="label">Tips</div><div class="value">${money(sum('tips'))}</div></div>
    <div class="stat"><div class="label">Wax</div><div class="value">${money(sum('wax'))}</div></div>`;
  $('#hist-head').innerHTML = `<tr><th>Day</th>${state.shops.map((s) => `<th class="r">${esc(s.name)}</th>`).join('')}<th class="r">Cuts</th><th class="r">Card</th><th class="r">Cash</th><th class="r">Total</th></tr>`;
  $('#hist-body').innerHTML = [...days.values()].map((d) => `
    <tr class="click" data-date="${d.date}">
      <td>${prettyDate(d.date)}</td>
      ${state.shops.map((s) => `<td class="r">${d.shops[s.id] ? money(d.shops[s.id].total) : '–'}</td>`).join('')}
      <td class="r">${d.cuts}</td><td class="r">${money(d.card)}</td><td class="r">${money(d.cash)}</td><td class="r">${money(d.fresha || 0)}</td><td class="r"><b>${money(d.total)}</b></td>
    </tr>`).join('') || `<tr><td colspan="${state.shops.length + 6}" class="muted">No days logged in this period.</td></tr>`;
}

$('#hist-range').addEventListener('change', loadHistory);
$('#hist-body').addEventListener('click', (ev) => {
  const r = ev.target.closest('[data-date]');
  if (!r) return;
  $('#day-shop').value = 'all';
  state.date = r.dataset.date;
  openTab('day');
});

// ---------- barbers ----------
async function loadBarbers() {
  state.barbers = await api('/api/admin/barbers');
  const shopOpts = (sel) => state.shops.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  $('#barber-rows').innerHTML = state.barbers.map((b) => `
    <tr data-id="${b.id}">
      <td><input type="text" data-f="name" value="${esc(b.name)}"></td>
      <td><select data-f="shop_id">${shopOpts(b.shop_id)}</select></td>
      <td><input class="num" data-f="rate" value="${+(b.commission_rate * 100).toFixed(1)}" style="width:80px" inputmode="decimal"></td>
      <td><input type="checkbox" data-f="active" ${b.active ? 'checked' : ''} style="width:22px;height:22px"></td>
      <td><button class="btn small" data-save>Save</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">No barbers yet. Add them above.</td></tr>';
}

$('#barber-add').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await api('/api/admin/barbers', { method: 'POST', body: { name: $('#nb-name').value, shop_id: Number($('#nb-shop').value), commission_rate: Number($('#nb-rate').value) / 100 } });
    $('#nb-name').value = '';
    toast('Barber added');
    loadBarbers();
  } catch (e) { toast(e.message, true); }
});

$('#barber-rows').addEventListener('click', async (ev) => {
  if (!ev.target.matches('[data-save]')) return;
  const tr = ev.target.closest('tr');
  const f = (k) => tr.querySelector(`[data-f="${k}"]`);
  try {
    await api('/api/admin/barbers/' + tr.dataset.id, { method: 'PUT', body: { name: f('name').value, shop_id: Number(f('shop_id').value), commission_rate: Number(f('rate').value) / 100, active: f('active').checked } });
    toast('Saved');
    loadBarbers();
  } catch (e) { toast(e.message, true); }
});

// ---------- services ----------
async function loadServices() {
  state.services = await api('/api/admin/services');
  const shopId = Number($('#svc-shop').value);
  const list = state.services.filter((s) => s.shop_id === shopId);
  $('#svc-rows').innerHTML = list.map((s) => `
    <tr data-id="${s.id}">
      <td><input class="num" data-f="sort" value="${s.sort}" style="width:64px" inputmode="numeric"></td>
      <td><input type="text" data-f="name" value="${esc(s.name)}"></td>
      <td><input class="num" data-f="price" value="${(s.price_pence / 100).toFixed(2)}" style="width:100px" inputmode="decimal"></td>
      <td><input type="checkbox" data-f="active" ${s.active ? 'checked' : ''} style="width:22px;height:22px"></td>
      <td><button class="btn small" data-save>Save</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">No services for this shop yet.</td></tr>';
}

$('#svc-shop').addEventListener('change', loadServices);

$('#svc-add').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const shopId = Number($('#svc-shop').value);
  const sort = Math.max(-1, ...state.services.filter((s) => s.shop_id === shopId).map((s) => s.sort)) + 1;
  try {
    await api('/api/admin/services', { method: 'POST', body: { shop_id: shopId, name: $('#ns-name').value, price_pence: toPence($('#ns-price').value), sort } });
    $('#ns-name').value = ''; $('#ns-price').value = '';
    toast('Service added');
    loadServices();
  } catch (e) { toast(e.message, true); }
});

$('#svc-rows').addEventListener('click', async (ev) => {
  if (!ev.target.matches('[data-save]')) return;
  const tr = ev.target.closest('tr');
  const f = (k) => tr.querySelector(`[data-f="${k}"]`);
  try {
    await api('/api/admin/services/' + tr.dataset.id, { method: 'PUT', body: { name: f('name').value, price_pence: toPence(f('price').value), active: f('active').checked, sort: Number(f('sort').value) } });
    toast('Saved');
    loadServices();
  } catch (e) { toast(e.message, true); }
});

// ---------- settings ----------
async function loadSettings() {
  const settings = await api('/api/admin/settings');
  $('#wax-price').value = (Number(settings.wax_price_pence || 1000) / 100).toFixed(2);
  $('#shop-rows').innerHTML = state.shops.map((s) => `
    <form class="form-row" data-shop="${s.id}">
      <input type="text" value="${esc(s.name)}" required>
      <button class="btn">Rename</button>
    </form>`).join('');
}

$('#shop-rows').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  try {
    await api('/api/admin/shops/' + form.dataset.shop, { method: 'PUT', body: { name: form.querySelector('input').value } });
    state.shops = await api('/api/shops');
    fillShopSelects();
    toast('Shop renamed');
  } catch (e) { toast(e.message, true); }
});

$('#wax-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try { await api('/api/admin/settings', { method: 'PUT', body: { wax_price_pence: toPence($('#wax-price').value) } }); toast('Wax price saved'); } catch (e) { toast(e.message, true); }
});

boot();
