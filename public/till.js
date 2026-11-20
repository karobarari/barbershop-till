const api = makeApi('till_token', () => { store('till_token', null); show('login'); });
const TIP_OPTIONS = [0, 100, 200, 300, 500, 1000];

const state = {
  shopId: null, shop: null, barbers: [], services: [], date: null,
  form: null, today: null, armedVoid: null,
};

function show(view) {
  for (const v of ['login', 'shop', 'till', 'eod']) $('#view-' + v).classList.toggle('hidden', v !== view);
  window.scrollTo(0, 0);
}

// ---------- boot ----------
async function boot() {
  if (!store('till_token')) return show('login');
  state.shopId = store('till_shop');
  if (!state.shopId) return pickShop();
  try { await loadShop(); show('till'); } catch (e) { if (e.message !== 'Not logged in') { store('till_shop', null); pickShop(); } }
}

$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('#login-err').textContent = '';
  try {
    const { token } = await api('/api/till/login', { method: 'POST', body: { password: $('#login-pw').value } });
    store('till_token', token);
    $('#login-pw').value = '';
    boot();
  } catch (e) { $('#login-err').textContent = e.message; }
});

async function pickShop() {
  const shops = await api('/api/shops');
  $('#shop-list').innerHTML = shops.map((s) => `<button class="tile" data-id="${s.id}"><span class="t-name">${esc(s.name)}</span></button>`).join('');
  show('shop');
}

$('#shop-list').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-id]');
  if (!b) return;
  store('till_shop', b.dataset.id);
  state.shopId = b.dataset.id;
  await loadShop();
  show('till');
});

$('#btn-switch').addEventListener('click', () => { store('till_shop', null); pickShop(); });

async function loadShop() {
  const data = await api(`/api/till/${state.shopId}/bootstrap`);
  Object.assign(state, { shop: data.shop, barbers: data.barbers, services: data.services, date: data.date });
  $('#shop-name').textContent = data.shop.name;
  $('#today-date').textContent = prettyDate(data.date);
  document.title = `Till · ${data.shop.name}`;
  renderBarbers();
  closeForm();
  await loadToday();
}

// ---------- barbers ----------
function renderBarbers() {
  const mine = state.barbers.filter((b) => String(b.shop_id) === String(state.shopId));
  const other = state.barbers.filter((b) => String(b.shop_id) !== String(state.shopId));
  const tile = (b, cls = '') => `<button class="tile ${cls}" data-barber="${b.id}"><span class="t-name">${esc(b.name)}</span>${cls ? `<span class="t-sub">${esc(b.shop_name)}</span>` : ''}</button>`;
  $('#barbers').innerHTML = mine.map((b) => tile(b)).join('');
  $('#barbers-other').innerHTML = other.map((b) => tile(b, 'other')).join('');
  $('#other-wrap').classList.toggle('hidden', !other.length);
  $('#no-barbers').classList.toggle('hidden', state.barbers.length > 0);
}

$('#step-barber').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-barber]');
  if (b) openForm(Number(b.dataset.barber));
});

// ---------- log form ----------
function openForm(barberId) {
  const barber = state.barbers.find((b) => b.id === barberId);
  state.form = { barber, serviceId: null, price: '', tip: 0, tipCustom: false, pay: null };
  $('#log-barber').textContent = barber.name;
  $('#step-barber').classList.add('hidden');
  $('#today-section').classList.add('hidden');
  $('#step-log').classList.remove('hidden');
  $('#tip-custom').value = '';
  renderForm();
  window.scrollTo(0, 0);
}

function closeForm() {
  state.form = null;
  $('#step-log').classList.add('hidden');
  $('#step-barber').classList.remove('hidden');
  $('#today-section').classList.remove('hidden');
}

$('#btn-cancel').addEventListener('click', closeForm);

function formTotals() {
  const f = state.form;
  const price = f.price === '' ? 0 : toPence(f.price);
  const tip = f.tipCustom ? (toPence($('#tip-custom').value) || 0) : f.tip;
  return { price, tip, total: (price || 0) + tip };
}

function renderForm() {
  const f = state.form;
  $('#services').innerHTML = state.services.map((s) => `
    <button class="tile ${f.serviceId === s.id ? 'selected' : ''}" data-service="${s.id}">
      <span class="t-name">${esc(s.name)}</span><span class="t-sub num">${money(s.price_pence)}</span>
    </button>`).join('') || '<p class="muted">No services set up for this shop yet.</p>';
  $('#tips').innerHTML = TIP_OPTIONS.map((t) => `<button class="chip ${!f.tipCustom && f.tip === t ? 'selected' : ''}" data-tip="${t}">${t ? money(t).replace('.00', '') : 'No tip'}</button>`).join('')
    + `<button class="chip ${f.tipCustom ? 'selected' : ''}" data-tip="custom">Other</button>`;
  $('#tip-custom').classList.toggle('hidden', !f.tipCustom);
  document.querySelectorAll('[data-pay]').forEach((b) => { b.className = f.pay === b.dataset.pay ? 'sel-' + f.pay : ''; });
  renderTotal();
}

function renderTotal() {
  const t = formTotals();
  $('#total').textContent = money(t.total);
  const parts = [`Cut ${money(t.price)}`];
  if (t.tip) parts.push(`tip ${money(t.tip)}`);
  $('#breakdown').textContent = parts.join(' + ');
  const f = state.form;
  $('#btn-save').disabled = !(f.serviceId && f.pay && !Number.isNaN(t.price) && t.price >= 0);
}

$('#services').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-service]');
  if (!b) return;
  const s = state.services.find((x) => x.id === Number(b.dataset.service));
  state.form.serviceId = s.id;
  state.form.price = (s.price_pence / 100).toFixed(2);
  $('#price').value = state.form.price;
  renderForm();
});

$('#price').addEventListener('input', () => { state.form.price = $('#price').value; renderTotal(); });

$('#tips').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-tip]');
  if (!b) return;
  if (b.dataset.tip === 'custom') { state.form.tipCustom = true; renderForm(); $('#tip-custom').focus(); return; }
  state.form.tipCustom = false;
  state.form.tip = Number(b.dataset.tip);
  renderForm();
});
$('#tip-custom').addEventListener('input', renderTotal);


document.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => { state.form.pay = b.dataset.pay; renderForm(); }));

$('#btn-save').addEventListener('click', async () => {
  const f = state.form;
  const t = formTotals();
  if (Number.isNaN(t.tip) || t.tip < 0) return toast('Check the tip amount', true);
  $('#btn-save').disabled = true;
  try {
    const res = await api('/api/till/entries', {
      method: 'POST',
      body: { shopId: Number(state.shopId), barberId: f.barber.id, serviceId: f.serviceId, pricePence: t.price, tipPence: t.tip, paymentMethod: f.pay },
    });
    toast(`Logged ${money(res.total_pence)} for ${f.barber.name}`);
    closeForm();
    await loadToday();
  } catch (e) {
    toast(e.message, true);
    $('#btn-save').disabled = false;
  }
});

// ---------- today ----------
async function loadToday() {
  const data = await api(`/api/till/${state.shopId}/today`);
  state.today = data;
  if (data.date !== state.date) { state.date = data.date; $('#today-date').textContent = prettyDate(data.date); }
  renderSheet(data.entries);
}

// One column per barber, their cuts listed underneath (oldest at the top).
function renderSheet(entries) {
  const cols = state.barbers
    .filter((b) => String(b.shop_id) === String(state.shopId))
    .map((b) => ({ id: b.id, name: b.name, entries: [] }));
  for (const e of entries) {
    let col = cols.find((c) => c.id === e.barber_id);
    if (!col) { col = { id: e.barber_id, name: e.barber_name, entries: [] }; cols.push(col); }
    col.entries.push(e);
  }
  for (const c of cols) c.entries.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  if (!cols.length) {
    $('#today-head').innerHTML = '';
    $('#today-foot').innerHTML = '';
    $('#today-log').innerHTML = '<tr><td class="muted">Nothing logged yet today.</td></tr>';
    return;
  }

  $('#today-head').innerHTML = `<tr><th class="row-no">#</th>${cols.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr>`;
  const rows = Math.max(1, ...cols.map((c) => c.entries.length));
  let html = '';
  for (let i = 0; i < rows; i++) {
    html += `<tr><td class="row-no muted num">${i + 1}</td>${cols.map((c) => {
      const e = c.entries[i];
      if (!e) return '<td></td>';
      const extras = [e.tip_pence ? `tip ${money(e.tip_pence)}` : '', e.wax_qty ? `wax ×${e.wax_qty}` : ''].filter(Boolean).join(' · ');
      return `<td class="cell ${e.voided ? 'voided' : ''}">
        <div class="cell-top"><span class="num muted">${e.time}</span><b class="num">${money(e.price_pence + e.tip_pence + e.wax_pence)}</b></div>
        <div class="cell-svc">${esc(e.service_name)}${extras ? ` <span class="muted">· ${extras}</span>` : ''}</div>
        <div class="cell-bot keep"><span class="tag ${e.payment_method}">${payLabel(e.payment_method)}</span>
          <button class="btn small ${e.voided ? '' : 'danger'}" data-void="${e.id}">${e.voided ? 'Undo' : (state.armedVoid === e.id ? 'Tap to confirm' : 'Void')}</button></div>
      </td>`;
    }).join('')}</tr>`;
  }
  $('#today-log').innerHTML = html;

  // Total per barber (voided cuts don't count).
  $('#today-foot').innerHTML = `<tr><td class="row-no">Total</td>${cols.map((c) => {
    const live = c.entries.filter((e) => !e.voided);
    const sum = live.reduce((s, e) => s + e.price_pence + e.tip_pence + e.wax_pence, 0);
    return `<td class="cell-total"><div class="num">${money(sum)}</div><div class="muted">${live.length} cut${live.length === 1 ? '' : 's'}</div></td>`;
  }).join('')}</tr>`;
}

function statCards(t) {
  return `
    <div class="stat hero"><div class="label">Total</div><div class="value">${money(t.total)}</div></div>
    <div class="stat"><div class="label">Cuts</div><div class="value">${t.cuts}</div></div>
    <div class="stat"><div class="label">Card</div><div class="value">${money(t.card)}</div></div>
    <div class="stat"><div class="label">Cash</div><div class="value">${money(t.cash)}</div></div>
    <div class="stat"><div class="label">Fresha</div><div class="value">${money(t.fresha)}</div></div>
    <div class="stat"><div class="label">Tips</div><div class="value">${money(t.tips)}</div></div>
    <div class="stat"><div class="label">Wax (${t.wax_qty})</div><div class="value">${money(t.wax)}</div></div>`;
}

$('#today-log').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-void]');
  if (!b) return;
  const id = Number(b.dataset.void);
  const entry = state.today.entries.find((e) => e.id === id);
  if (!entry.voided && state.armedVoid !== id) { state.armedVoid = id; loadToday(); setTimeout(() => { if (state.armedVoid === id) { state.armedVoid = null; loadToday(); } }, 4000); return; }
  state.armedVoid = null;
  try { await api(`/api/till/entries/${id}/void`, { method: 'POST' }); toast(entry.voided ? 'Entry restored' : 'Entry voided'); } catch (e) { toast(e.message, true); }
  loadToday();
});

// ---------- end of day ----------
$('#btn-eod').addEventListener('click', async () => {
  await loadToday();
  const { summary, date } = state.today;
  const t = summary.totals;
  $('#eod-sub').textContent = `${state.shop.name} · ${prettyDate(date)}`;
  $('#eod-stats').innerHTML = statCards(t);
  $('#eod-check').innerHTML = `
    <div class="row-inline" style="gap:28px">
      <div><div class="muted" style="font-size:13px">Card machine should show</div><div class="num" style="font-size:26px;font-weight:800;color:var(--card)">${money(t.card)}</div></div>
      <div><div class="muted" style="font-size:13px">Cash in the drawer should be</div><div class="num" style="font-size:26px;font-weight:800;color:var(--cash)">${money(t.cash)}</div></div>
      <div><div class="muted" style="font-size:13px">Paid through Fresha</div><div class="num" style="font-size:26px;font-weight:800;color:var(--fresha)">${money(t.fresha)}</div></div>
    </div>
    <p class="muted" style="margin:12px 0 0;font-size:13px">Includes tips paid the same way as the cut.</p>`;
  const row = (b, tag = 'td') => `<tr><${tag}>${esc(b.name)}</${tag}><td class="r">${b.cuts}</td><td class="r">${money(b.takings)}</td><td class="r">${money(b.tips)}</td><td class="r">${money(b.wax)}</td><td class="r">${money(b.card)}</td><td class="r">${money(b.cash)}</td><td class="r">${money(b.fresha)}</td><td class="r"><b>${money(b.total)}</b></td><td class="r">${money(b.commission)}</td></tr>`;
  $('#eod-barbers').innerHTML = summary.barbers.map((b) => row(b)).join('') || '<tr><td colspan="10" class="muted">Nothing logged today.</td></tr>';
  $('#eod-foot').innerHTML = summary.barbers.length ? row({ name: 'Shop total', ...t }) : '';
  show('eod');
});

$('#btn-back').addEventListener('click', () => show('till'));

// Keep the log fresh if two people use different devices, and roll over at midnight.
setInterval(() => { if (!$('#view-till').classList.contains('hidden') && !state.form) loadToday().catch(() => {}); }, 30000);

boot();
