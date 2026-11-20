const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const TZ = 'Europe/London';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const TILL_PASSWORD = process.env.TILL_PASSWORD || 'till123';
const SECRET = process.env.SESSION_SECRET || 'local-dev-secret-change-me';

if (!process.env.ADMIN_PASSWORD || !process.env.TILL_PASSWORD) {
  console.warn('WARNING: using default passwords (admin123 / till123). Set ADMIN_PASSWORD and TILL_PASSWORD in production.');
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------- helpers ----------
const sign = (role, pw) => crypto.createHmac('sha256', SECRET).update(`${role}:${pw}`).digest('hex');
const tokens = { admin: () => sign('admin', ADMIN_PASSWORD), till: () => sign('till', TILL_PASSWORD) };

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function auth(...roles) {
  return (req, res, next) => {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    for (const r of roles) if (safeEqual(t, tokens[r]())) { req.role = r; return next(); }
    res.status(401).json({ error: 'Not logged in' });
  };
}

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
});

function bad(msg) { const e = new Error(msg); e.status = 400; return e; }

function todayLondon() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const toInt = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

const ENTRY_SELECT = `
  SELECT e.id, e.shop_id, s.name AS shop_name, e.barber_id, b.name AS barber_name,
         e.service_id, e.service_name, e.price_pence, e.tip_pence, e.wax_qty, e.wax_pence,
         e.payment_method, e.commission_rate::float AS commission_rate, e.voided, e.voided_at, e.created_at,
         to_char(e.created_at AT TIME ZONE '${TZ}', 'HH24:MI') AS time
  FROM till_entries e
  JOIN shops s ON s.id = e.shop_id
  JOIN barbers b ON b.id = e.barber_id`;

async function entriesForDay(date, shopId) {
  const params = [date];
  let where = `(e.created_at AT TIME ZONE '${TZ}')::date = $1::date`;
  if (shopId) { params.push(shopId); where += ` AND e.shop_id = $2`; }
  return db.query(`${ENTRY_SELECT} WHERE ${where} ORDER BY e.created_at DESC, e.id DESC`, params);
}

function emptyTotals() {
  return { cuts: 0, takings: 0, tips: 0, wax_qty: 0, wax: 0, total: 0, card: 0, cash: 0, fresha: 0, commission: 0 };
}

function add(t, e) {
  const total = e.price_pence + e.tip_pence + e.wax_pence;
  t.cuts += 1;
  t.takings += e.price_pence;
  t.tips += e.tip_pence;
  t.wax_qty += e.wax_qty;
  t.wax += e.wax_pence;
  t.total += total;
  t[e.payment_method] += total;
  t.commission += Math.round(e.price_pence * e.commission_rate);
}

function summarise(entries) {
  const totals = emptyTotals();
  const byBarber = new Map();
  const byShop = new Map();
  for (const e of entries) {
    if (e.voided) continue;
    add(totals, e);
    if (!byBarber.has(e.barber_id)) byBarber.set(e.barber_id, { barber_id: e.barber_id, name: e.barber_name, ...emptyTotals() });
    add(byBarber.get(e.barber_id), e);
    if (!byShop.has(e.shop_id)) byShop.set(e.shop_id, { shop_id: e.shop_id, name: e.shop_name, ...emptyTotals() });
    add(byShop.get(e.shop_id), e);
  }
  const sort = (a, b) => b.total - a.total;
  return { totals, barbers: [...byBarber.values()].sort(sort), shops: [...byShop.values()].sort((a, b) => a.shop_id - b.shop_id) };
}

// ---------- auth ----------
app.post('/api/till/login', (req, res) => {
  if (!safeEqual(req.body.password, TILL_PASSWORD)) return res.status(401).json({ error: 'Wrong password' });
  res.json({ token: tokens.till() });
});

app.post('/api/admin/login', (req, res) => {
  if (!safeEqual(req.body.password, ADMIN_PASSWORD)) return res.status(401).json({ error: 'Wrong password' });
  res.json({ token: tokens.admin() });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- shared ----------
app.get('/api/shops', auth('till', 'admin'), wrap(async (req, res) => {
  res.json(await db.query('SELECT id, name FROM shops ORDER BY sort, id'));
}));

// ---------- till ----------
app.get('/api/till/:shopId/bootstrap', auth('till', 'admin'), wrap(async (req, res) => {
  const shopId = toInt(req.params.shopId);
  const [shop] = await db.query('SELECT id, name FROM shops WHERE id=$1', [shopId]);
  if (!shop) throw bad('Shop not found');
  const barbers = await db.query(
    `SELECT b.id, b.name, b.shop_id, s.name AS shop_name FROM barbers b JOIN shops s ON s.id=b.shop_id
     WHERE b.active ORDER BY (b.shop_id = $1) DESC, b.sort, b.name`, [shopId]);
  const services = await db.query('SELECT id, name, price_pence FROM services WHERE shop_id=$1 AND active ORDER BY sort, id', [shopId]);
  const [wax] = await db.query(`SELECT value FROM settings WHERE key='wax_price_pence'`);
  const [float] = await db.query(`SELECT value FROM settings WHERE key='cash_float_pence'`);
  res.json({ shop, barbers, services, wax_price_pence: toInt(wax && wax.value, 1000), cash_float_pence: toInt(float && float.value, 2000), date: todayLondon() });
}));

app.post('/api/till/entries', auth('till', 'admin'), wrap(async (req, res) => {
  const { shopId, barberId, serviceId, pricePence, tipPence, waxQty, paymentMethod } = req.body || {};
  if (!['card', 'cash', 'fresha'].includes(paymentMethod)) throw bad('Choose card, cash or Fresha');
  const [barber] = await db.query('SELECT id, commission_rate FROM barbers WHERE id=$1 AND active', [toInt(barberId)]);
  if (!barber) throw bad('Barber not found');
  const [service] = await db.query('SELECT id, name, price_pence FROM services WHERE id=$1 AND shop_id=$2', [toInt(serviceId), toInt(shopId)]);
  if (!service) throw bad('Choose a service');
  const price = pricePence === undefined || pricePence === null || pricePence === '' ? service.price_pence : toInt(pricePence, -1);
  const tip = toInt(tipPence, 0);
  const qty = toInt(waxQty, 0);
  if (price < 0 || price > 100000) throw bad('Price looks wrong');
  if (tip < 0 || tip > 50000) throw bad('Tip looks wrong');
  if (qty < 0 || qty > 20) throw bad('Wax quantity looks wrong');
  const [wax] = await db.query(`SELECT value FROM settings WHERE key='wax_price_pence'`);
  const waxPence = qty * toInt(wax && wax.value, 1000);
  const [row] = await db.query(
    `INSERT INTO till_entries (shop_id, barber_id, service_id, service_name, price_pence, tip_pence, wax_qty, wax_pence, payment_method, commission_rate)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [toInt(shopId), barber.id, service.id, service.name, price, tip, qty, waxPence, paymentMethod, barber.commission_rate]);
  res.json({ id: row.id, total_pence: price + tip + waxPence });
}));

app.get('/api/till/:shopId/today', auth('till', 'admin'), wrap(async (req, res) => {
  const date = todayLondon();
  const entries = await entriesForDay(date, toInt(req.params.shopId));
  res.json({ date, entries, summary: summarise(entries) });
}));

// Void (not delete) so the owners can still see it in the log. Till can only void today's entries.
app.post('/api/till/entries/:id/void', auth('till', 'admin'), wrap(async (req, res) => {
  const id = toInt(req.params.id);
  const extra = req.role === 'admin' ? '' : ` AND (created_at AT TIME ZONE '${TZ}')::date = $2::date`;
  const params = req.role === 'admin' ? [id] : [id, todayLondon()];
  const rows = await db.query(`UPDATE till_entries SET voided = NOT voided, voided_at = CASE WHEN voided THEN NULL ELSE now() END
    WHERE id=$1${extra} RETURNING id, voided`, params);
  if (!rows.length) throw bad('Entry not found or not from today');
  res.json(rows[0]);
}));

// ---------- admin ----------
app.get('/api/admin/day', auth('admin'), wrap(async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : todayLondon();
  const shopId = req.query.shopId && req.query.shopId !== 'all' ? toInt(req.query.shopId) : null;
  const entries = await entriesForDay(date, shopId);
  res.json({ date, today: todayLondon(), entries, summary: summarise(entries) });
}));

app.get('/api/admin/day.csv', auth('admin'), wrap(async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : todayLondon();
  const shopId = req.query.shopId && req.query.shopId !== 'all' ? toInt(req.query.shopId) : null;
  const entries = await entriesForDay(date, shopId);
  const p = (n) => (n / 100).toFixed(2);
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = ['Date,Time,Shop,Barber,Service,Price,Tip,Wax qty,Wax,Total,Payment,Voided'];
  for (const e of [...entries].reverse()) {
    lines.push([date, e.time, q(e.shop_name), q(e.barber_name), q(e.service_name), p(e.price_pence), p(e.tip_pence),
      e.wax_qty, p(e.wax_pence), p(e.price_pence + e.tip_pence + e.wax_pence), e.payment_method, e.voided ? 'yes' : ''].join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="till-${date}.csv"`);
  res.send(lines.join('\n'));
}));

app.get('/api/admin/history', auth('admin'), wrap(async (req, res) => {
  const days = Math.min(Math.max(toInt(req.query.days, 30), 1), 366);
  const rows = await db.query(`
    SELECT to_char((e.created_at AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS date, e.shop_id, s.name AS shop_name,
           COUNT(*)::int AS cuts,
           SUM(e.price_pence)::int AS takings, SUM(e.tip_pence)::int AS tips, SUM(e.wax_pence)::int AS wax,
           SUM(e.price_pence + e.tip_pence + e.wax_pence)::int AS total,
           SUM(CASE WHEN e.payment_method='card' THEN e.price_pence + e.tip_pence + e.wax_pence ELSE 0 END)::int AS card,
           SUM(CASE WHEN e.payment_method='cash' THEN e.price_pence + e.tip_pence + e.wax_pence ELSE 0 END)::int AS cash,
           SUM(CASE WHEN e.payment_method='fresha' THEN e.price_pence + e.tip_pence + e.wax_pence ELSE 0 END)::int AS fresha
    FROM till_entries e JOIN shops s ON s.id = e.shop_id
    WHERE NOT e.voided AND e.created_at >= now() - ($1::int * INTERVAL '1 day')
    GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2`, [days]);
  res.json(rows);
}));

// Shops
app.put('/api/admin/shops/:id', auth('admin'), wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw bad('Name required');
  await db.query('UPDATE shops SET name=$1 WHERE id=$2', [name, toInt(req.params.id)]);
  res.json({ ok: true });
}));

// Barbers
app.get('/api/admin/barbers', auth('admin'), wrap(async (req, res) => {
  res.json(await db.query(`SELECT b.id, b.name, b.shop_id, b.active, b.commission_rate::float AS commission_rate
    FROM barbers b ORDER BY b.active DESC, b.shop_id, b.sort, b.name`));
}));

function barberBody(body) {
  const name = String(body.name || '').trim();
  if (!name) throw bad('Name required');
  const rate = body.commission_rate === undefined ? 0.5 : Number(body.commission_rate);
  if (!(rate >= 0 && rate <= 1)) throw bad('Commission must be between 0 and 100%');
  return { name, shop_id: toInt(body.shop_id), active: body.active !== false, rate };
}

app.post('/api/admin/barbers', auth('admin'), wrap(async (req, res) => {
  const b = barberBody(req.body);
  const [row] = await db.query('INSERT INTO barbers (name, shop_id, commission_rate, active) VALUES ($1,$2,$3,$4) RETURNING id',
    [b.name, b.shop_id, b.rate, b.active]);
  res.json(row);
}));

app.put('/api/admin/barbers/:id', auth('admin'), wrap(async (req, res) => {
  const b = barberBody(req.body);
  await db.query('UPDATE barbers SET name=$1, shop_id=$2, commission_rate=$3, active=$4 WHERE id=$5',
    [b.name, b.shop_id, b.rate, b.active, toInt(req.params.id)]);
  res.json({ ok: true });
}));

// Services
app.get('/api/admin/services', auth('admin'), wrap(async (req, res) => {
  res.json(await db.query('SELECT id, shop_id, name, price_pence, active, sort FROM services ORDER BY shop_id, active DESC, sort, id'));
}));

function serviceBody(body) {
  const name = String(body.name || '').trim();
  const price = toInt(body.price_pence, -1);
  if (!name) throw bad('Name required');
  if (price < 0) throw bad('Price required');
  return { name, price, shop_id: toInt(body.shop_id), active: body.active !== false, sort: toInt(body.sort, 99) };
}

app.post('/api/admin/services', auth('admin'), wrap(async (req, res) => {
  const s = serviceBody(req.body);
  const [row] = await db.query('INSERT INTO services (shop_id, name, price_pence, active, sort) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [s.shop_id, s.name, s.price, s.active, s.sort]);
  res.json(row);
}));

app.put('/api/admin/services/:id', auth('admin'), wrap(async (req, res) => {
  const s = serviceBody(req.body);
  await db.query('UPDATE services SET name=$1, price_pence=$2, active=$3, sort=$4 WHERE id=$5',
    [s.name, s.price, s.active, s.sort, toInt(req.params.id)]);
  res.json({ ok: true });
}));

// Settings
app.get('/api/admin/settings', auth('admin'), wrap(async (req, res) => {
  const rows = await db.query('SELECT key, value FROM settings');
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}));

// Accepts any of the known settings; each one sent is validated and saved.
const SETTINGS = { wax_price_pence: 'Wax price', cash_float_pence: 'Cash float' };
app.put('/api/admin/settings', auth('admin'), wrap(async (req, res) => {
  const keys = Object.keys(SETTINGS).filter((k) => req.body[k] !== undefined);
  if (!keys.length) throw bad('Nothing to save');
  for (const k of keys) {
    const v = toInt(req.body[k], -1);
    if (v < 0 || v > 100000) throw bad(`${SETTINGS[k]} looks wrong`);
  }
  for (const k of keys) {
    await db.query(`INSERT INTO settings (key, value) VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, String(toInt(req.body[k]))]);
  }
  res.json({ ok: true });
}));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

db.init().then(() => {
  app.listen(PORT, () => console.log(`Barbershop till running on http://localhost:${PORT} (${db.isPg ? 'Postgres' : 'local PGlite'})`));
}).catch((e) => { console.error('Failed to start', e); process.exit(1); });
