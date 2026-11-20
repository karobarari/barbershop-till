# Barbershop Till

A till for barbers to log cuts, tips and wax sales, with an owner admin dashboard. One database serves every shop.

- **Till** at `/`: pick a barber, then the service, tip, wax and how they paid (card, cash or Fresha), then **Log cut**. **End of day** shows totals for each barber and what the card machine and cash drawer should show, plus what was paid through Fresha.
- **Admin** at `/admin`: live day totals for each shop and all shops, the full log for any past day, history, CSV export, and management of barbers, services, prices, wax price and shop names.

## Run locally

```bash
npm install
npm start
# http://localhost:3000        till   (password: till123)
# http://localhost:3000/admin  admin  (password: admin123)
```

When `DATABASE_URL` isn't set, the app uses an embedded Postgres (PGlite) stored in `./data`, so you don't need to install a database.

## Deploy on Render (about 10 minutes)

1. Push this folder to a new GitHub repo.
2. In Render, choose **New**, then **Blueprint**, and pick the repo. `render.yaml` creates the web service and a Postgres database.
3. When Render asks, set **ADMIN_PASSWORD** (for the owners) and **TILL_PASSWORD** (entered once on each shop tablet).
4. Open the URL Render gives you, go to `/admin`, rename the shops, add the barbers and set your real prices.
5. On each shop tablet, open the URL, enter the till password, pick the shop, then use **Add to Home Screen**.

**Free tier limits:**
- The free web service sleeps after 15 minutes idle, and the first load afterwards takes about a minute.
- The free Postgres database expires after 30 days.

For real use, upgrade both on Render, or point `DATABASE_URL` at Supabase or Neon and set `DATABASE_SSL=true`.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. If it isn't set, the app uses local PGlite. |
| `DATABASE_SSL` | Set to `true` for external hosts (Supabase, Neon, Render's external URL). |
| `ADMIN_PASSWORD` | Owner login |
| `TILL_PASSWORD` | Device setup password for each shop's till |
| `SESSION_SECRET` | Any long random string |

## How the numbers work

- **Total** = cut price + tip + wax.
- **Card**, **Cash** and **Fresha** split each entry's whole total by how the customer paid. Card and Cash are what the card machine and cash drawer should show; Fresha is money taken through the Fresha app.
- **"50% of cuts"** is each barber's commission on cut prices only. Tips and wax are shown separately. Each barber's rate is set in Admin, and each entry stores the rate in place at the time.
- **Voiding** never deletes an entry. Voided entries stay in the log, crossed out, and are left out of totals. Barbers can only void today's entries. Owners can void or restore any entry.
- Days are counted in UK time (Europe/London).

## Data model

`shops`, `barbers` (home shop and commission rate), `services` (prices for each shop), `settings` (wax price), and `till_entries` (shop, barber, service, price, tip, wax, payment method, commission rate, voided).

Each entry stores the shop it was logged at, so barbers covering at the other shop are counted correctly. This is the base for weekly wages and bookings later.
