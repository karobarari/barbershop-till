// Database layer: real Postgres when DATABASE_URL is set (production),
// otherwise an embedded Postgres (PGlite) stored in ./data for local use.
const path = require('path');

let client;
let isPg = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shops (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS barbers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  shop_id INT NOT NULL REFERENCES shops(id),
  commission_rate NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  shop_id INT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  price_pence INT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS till_entries (
  id SERIAL PRIMARY KEY,
  shop_id INT NOT NULL REFERENCES shops(id),
  barber_id INT NOT NULL REFERENCES barbers(id),
  service_id INT REFERENCES services(id),
  service_name TEXT NOT NULL,
  price_pence INT NOT NULL,
  tip_pence INT NOT NULL DEFAULT 0,
  wax_qty INT NOT NULL DEFAULT 0,
  wax_pence INT NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  commission_rate NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  voided BOOLEAN NOT NULL DEFAULT FALSE,
  voided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Allowed payment methods (re-applied on start so older databases pick up new ones).
ALTER TABLE till_entries DROP CONSTRAINT IF EXISTS till_entries_payment_method_check;
ALTER TABLE till_entries ADD CONSTRAINT till_entries_payment_method_check CHECK (payment_method IN ('card','cash','fresha'));

CREATE INDEX IF NOT EXISTS till_entries_created_idx ON till_entries (created_at);
CREATE INDEX IF NOT EXISTS till_entries_shop_idx ON till_entries (shop_id, created_at);
`;

async function init() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    isPg = true;
    client = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    await client.query(SCHEMA);
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || path.join(__dirname, 'data', 'pglite');
    require('fs').mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
    await client.exec(SCHEMA);
  }
  await seed();
}

async function query(text, params = []) {
  const res = await client.query(text, params);
  return res.rows;
}

// Current price list. Hair Wax is also its own service button; the wax add-on price matches it.
const PRICE_LIST = [
  ['Haircut', 2300],
  ['Skin/Taper Fade', 2600],
  ['Haircut and Wash', 2700],
  ['Hair Re-style', 3000],
  ['Haircut and Beard Trim', 3900],
  ['Threading and Waxing', 1000],
  ['Beard Trim / Shave', 1500],
  ['Beard Colour', 2500],
  ['Facial Treatment', 3000],
  ['Hair Colour', 2500],
  ['Highlights', 8000],
  ['Hair Perm', 12000],
  ['Premium Package', 6500],
  ['Hair Wax', 1200],
];
const WAX_PRICE_PENCE = 1200;
const PRICE_LIST_VERSION = '4';

async function seed() {
  const shops = await query('SELECT id FROM shops');
  if (!shops.length) {
    await query(`INSERT INTO shops (name, sort) VALUES ('Shop 1', 1) RETURNING id`);
    await query(`INSERT INTO shops (name, sort) VALUES ('Shop 2', 2) RETURNING id`);
  }
  await applyPriceList();
}

// Brings the services up to the current price-list version. A brand-new database
// gets the full list; an existing one gets only the small step changes, so prices
// edited in Admin are left alone. Old services are hidden, never deleted, since
// past till entries point at them.
async function applyPriceList() {
  const [done] = await query(`SELECT value FROM settings WHERE key='price_list_version'`);
  const current = done ? Number(done.value) : 0;
  if (current >= Number(PRICE_LIST_VERSION)) return;
  const shops = await query('SELECT id FROM shops');
  if (current >= 2) {
    if (current < 3) {
      // v3: add the Hair Wax button at the end.
      for (const { id } of shops) {
        const [have] = await query(`SELECT id FROM services WHERE shop_id=$1 AND active AND lower(name)='hair wax'`, [id]);
        if (have) continue;
        const [{ next }] = await query('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM services WHERE shop_id=$1 AND active', [id]);
        await query('INSERT INTO services (shop_id, name, price_pence, sort) VALUES ($1,$2,$3,$4)', [id, 'Hair Wax', 1200, next]);
      }
    }
    if (current < 4) {
      // v4: Trim & Tan is no longer offered.
      await query(`UPDATE services SET active=FALSE WHERE lower(name) LIKE 'trim & tan%'`);
    }
  } else {
    await query('UPDATE services SET active=FALSE');
    for (const { id } of shops) {
      let i = 0;
      for (const [name, price] of PRICE_LIST) {
        await query('INSERT INTO services (shop_id, name, price_pence, sort) VALUES ($1,$2,$3,$4)', [id, name, price, i++]);
      }
    }
    await query(`INSERT INTO settings (key, value) VALUES ('wax_price_pence', $1)
                 ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [String(WAX_PRICE_PENCE)]);
  }
  await query(`INSERT INTO settings (key, value) VALUES ('price_list_version', $1)
               ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [PRICE_LIST_VERSION]);
}

module.exports = { init, query, get isPg() { return isPg; } };
